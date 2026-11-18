import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaults, mode, elapsed, platform, clock, size, isActive, presets, normalizeConfig, supportedFormats, estimatedBytes } from './shared.js';
import { listRecordings, recordingBlob, putRecording, deleteRecording } from './storage.js';
import { Icon } from './icons.jsx';
import './style.css';
const chromeReady = !!globalThis.chrome?.runtime?.id;
if (chromeReady) document.documentElement.classList.add('extension-popup');
async function send(type, data = {}) {
  if (!chromeReady) return { ok: true, state: { status: 'idle' }, devices: [], formats: supportedFormats(normalizeConfig(data.config), mime => mime.includes('webm')) };
  const reply = await chrome.runtime.sendMessage({ target: 'background', type, ...data });
  if (!reply?.ok) throw new Error(reply?.error || 'Recorder is unavailable. Reload the extension and reopen it.');
  return reply;
}
function Select({ label, children, ...props }) {
  return <label className="field"><span>{label}</span><select {...props}>{children}</select></label>;
}
function App() {
  const [config, setConfig] = useState(defaults), [state, setState] = useState({ status: 'idle' });
  const [tab, setTab] = useState({}), [view, setView] = useState('record'), [records, setRecords] = useState([]);
  const [devices, setDevices] = useState([]), [formats, setFormats] = useState([]), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(!chromeReady), [now, setNow] = useState(Date.now());
  const [preview, setPreview] = useState(null), [dialog, setDialog] = useState(null), [name, setName] = useState('');
  const [search, setSearch] = useState(''), [storage, setStorage] = useState(null), [advanced, setAdvanced] = useState(false);
  const scrollRef = useRef(null), localPreview = useRef(null);
  const active = isActive(state), exporting = state.export?.status === 'working';
  const settings = active ? normalizeConfig(state.config) : config;
  const capturedTab = active ? state.tab || tab : tab;
  const available = formats.find(f => f.id === settings.format)?.supported;
  const sessionError = error || state.error || (state.export?.status === 'error' ? state.export.error : '');
  async function refresh() {
    setRecords((await listRecordings()).sort((a, b) => b.date - a.date));
    if (navigator.storage?.estimate) setStorage(await navigator.storage.estimate());
  }
  async function refreshDevices() {
    try { setDevices((await send('devices')).devices || []); } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    refresh().catch(e => setError(e.message));
    if (!chromeReady) return;
    const listener = message => {
      if (message.target !== 'popup' || message.type !== 'state') return;
      setState(message.state);
      if (['idle', 'error'].includes(message.state.status)) refresh().catch(e => setError(e.message));
    };
    chrome.runtime.onMessage.addListener(listener);
    Promise.all([chrome.storage.local.get('config'), send('state'), chrome.tabs.query({ active: true, currentWindow: true })])
      .then(([stored, current, tabs]) => { setConfig(normalizeConfig(stored.config)); setState(current.state); setTab(tabs[0] || {}); })
      .catch(e => setError(e.message)).finally(() => setLoaded(true));
    refreshDevices();
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let cancelled = false;
    send('formats', { config: { video: settings.video, microphone: settings.microphone, tabAudio: settings.tabAudio } })
      .then(r => { if (!cancelled) setFormats(r.formats || []); }).catch(e => setError(e.message));
    return () => { cancelled = true; };
  }, [settings.video, settings.microphone, settings.tabAudio]);
  useEffect(() => () => { if (localPreview.current) URL.revokeObjectURL(localPreview.current); }, []);
  function change(values) {
    const next = normalizeConfig({ ...config, ...values }); setConfig(next);
    if (chromeReady) chrome.storage.local.set({ config: next }).catch(e => setError(e.message));
  }
  async function volume(key, value) {
    if (!active) return change({ [key]: value });
    try {
      const reply = await send('volume', { source: key === 'micVolume' ? 'microphone' : 'tabAudio', value });
      if (reply.state) setState(reply.state);
      change({ [key]: value });
    } catch (e) { setError(e.message); }
  }
  async function action(type, args = {}) {
    setBusy(true); setError('');
    try { const reply = await send(type, { config, ...args }); if (reply.state) setState(reply.state); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function libraryAction(fn) {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function play(record) {
    const blob = await recordingBlob(record.id);
    if (localPreview.current) URL.revokeObjectURL(localPreview.current);
    localPreview.current = URL.createObjectURL(blob);
    setPreview({ url: localPreview.current, record });
  }
  function closePreview() { setPreview(null); if (localPreview.current) URL.revokeObjectURL(localPreview.current); localPreview.current = null; }
  function navigate(next) { setView(next); scrollRef.current?.scrollTo(0, 0); if (next === 'library') refresh().catch(e => setError(e.message)); }
  function formatLabel() { return (state.extension || settings.format).toUpperCase(); }
  const filtered = records.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  return <main className="app-shell">
    <header className="app-header">
      <div className="brand-mark"><Icon name="record" size={26}/></div>
      <div className="brand-copy"><h1>Meet & X <span>Recorder</span></h1><p>CAPTURE THE CONVERSATION</p></div>
      <span className={'status-pill ' + (active ? 'is-live' : '')}><i/>{state.status === 'idle' || state.status === 'error' ? 'Ready' : state.status}</span>
    </header>
    <nav className="tabs" aria-label="Main navigation">
      <button aria-current={view === 'record' ? 'page' : undefined} onClick={() => navigate('record')}><Icon name="record" size={16}/>Recorder</button>
      <button aria-current={view === 'library' ? 'page' : undefined} onClick={() => navigate('library')}><Icon name="library" size={16}/>Library<span className="count">{records.length}</span></button>
      <span className="local-tag"><Icon name="shield" size={12}/> LOCAL ONLY</span>
    </nav>
    <div className="scroll-content" ref={scrollRef}>
      {!chromeReady && <div className="notice">Preview mode. Load the <b>dist</b> folder in Chrome to record.</div>}
      {sessionError && <div className="error" role="alert"><span>{sessionError}</span><button aria-label="Dismiss error" onClick={() => { setError(''); action('dismissError'); }}><Icon name="close" size={15}/></button></div>}
      {state.export?.status === 'working' && <div role="status" className="export-progress"><div><Icon name="download" size={16}/><span>{state.export.format === 'mp3' ? 'Encoding MP3 locally' : 'Preparing download'}…</span><b>{state.export.progress || 0}%</b></div><progress max="100" value={state.export.progress || 0}/><p>You can close the popup. The export continues here.</p></div>}
      {state.export?.status === 'ready' && <div className="success" role="status"><Icon name="check" size={14}/>Download prepared. Check Chrome’s download or save dialog.</div>}
      {state.savedId && !active && !sessionError && <div className="success saved-feedback" role="status"><Icon name="check" size={14}/>Recording saved locally.<button className="text-button" onClick={() => navigate('library')}>View Library<Icon name="arrow" size={12}/></button></div>}
      {view === 'record' ? <>
        <section className="capture-target">
          <div className={'platform-mark ' + (platform(capturedTab.url) === 'Google Meet' ? 'meet' : '')}>{platform(capturedTab.url) === 'Google Meet' ? <Icon name="video" size={22}/> : <Icon name="audio" size={21}/>}</div>
          <div><span className="eyebrow">{active ? 'RECORDING FROM' : 'CURRENT TAB'}</span><h2>{platform(capturedTab.url)}</h2><p title={capturedTab.title}>{capturedTab.title || 'Open a meeting, Space, or video tab'}</p></div>
          <span className="source-tag">{settings.video ? settings.microphone || settings.tabAudio ? 'VIDEO + AUDIO' : 'VIDEO ONLY' : 'AUDIO STREAM'}</span>
        </section>
        <section className={'session-hero ' + (active ? 'active-session' : '')}>
          <div className="session-caption"><span className="live-dot"/>{active ? state.status === 'paused' ? 'PAUSED · YOUR PLACE IS SAVED' : state.status === 'recording' ? 'CAPTURING YOUR STREAM' : state.status.toUpperCase() + '…' : 'READY WHEN YOU ARE'}</div>
          <div className="timer-digits" aria-label="Recording duration">{clock(active ? elapsed(state, now) : 0)}</div>
          <p>{mode(settings)}</p>
          <div className="session-stats"><span><Icon name="file" size={12}/>{size(active ? state.bytes : 0)}</span><span>{settings.video ? settings.quality + 'p / ' + settings.fps + ' fps' : settings.audioKbps + ' kbps'}</span><span>{active ? formatLabel() : settings.format.toUpperCase()}</span></div>
          {active && state.actualVideo?.height && <div className="actual-quality">Actual capture {state.actualVideo.width} × {state.actualVideo.height}{state.actualVideo.frameRate ? ' · ' + Math.round(state.actualVideo.frameRate) + ' fps' : ''}</div>}
        </section>
        {!active && <section className="presets-section"><div className="section-heading"><h3>Quick setup</h3><span>BUILT FOR YOUR SESSION</span></div><div className="preset-grid">{Object.entries(presets).map(([id, preset]) => {
          const chosen = Object.entries(preset).filter(([key]) => !['label', 'detail'].includes(key)).every(([key, value]) => settings[key] === value);
          return <button className={'preset ' + (chosen ? 'chosen' : '')} key={id} disabled={!loaded || busy || exporting} onClick={() => change(Object.fromEntries(Object.entries(preset).filter(([key]) => !['label', 'detail'].includes(key))))}><Icon name={id === 'voice' ? 'audio' : id === 'meeting' ? 'video' : 'settings'} size={16}/><b>{preset.label}</b><span>{preset.detail}</span></button>;
        })}</div></section>}
        <section className="sources-section"><div className="section-heading"><h3>Recording sources</h3><span>{active ? 'SOURCES LOCKED DURING CAPTURE' : 'CHOOSE WHAT TO CAPTURE'}</span></div><div className="source-list">{[
          ['video', 'video', 'Tab video', 'Meeting, presentation or playing video'],
          ['microphone', 'mic', 'Microphone', 'Your voice · separate from Meet mute'],
          ['tabAudio', 'audio', 'Tab audio', 'Other participants and tab playback'],
        ].map(([key, icon, title, detail]) => <div className={'source-row ' + (settings[key] ? 'enabled' : '')} key={key}>
          <div className="source-icon"><Icon name={icon}/></div><div className="source-copy"><strong>{title}</strong><p>{detail}</p></div>
          {key !== 'video' && active && <div className="mini-level" aria-label={title + ' level'}><span style={{ height: (state.status === 'recording' ? (state.levels?.[key] || 0) * 100 : 0) + '%' }}/></div>}
          <button className={'switch ' + (settings[key] ? 'on' : '')} role="switch" aria-label={title} aria-checked={settings[key]} disabled={active || !loaded || busy} onClick={() => change({ [key]: !settings[key] })}><span/></button>
        </div>)}</div></section>
        <section className="quality-card"><div className="section-heading"><h3><Icon name="settings" size={15}/>Recording quality</h3><span>QUALITY ↔ FILE SIZE</span></div>
          <div className="quality-grid">
            <Select label={settings.video ? 'Video container' : 'Audio container'} aria-label="Recording format" disabled={active || !loaded || !formats.length} value={settings.format} onChange={e => change({ format: e.target.value })}>
              {formats.map(f => <option key={f.id} value={f.id} disabled={!f.supported}>{f.label}{!f.supported ? ' · unavailable' : f.id === 'webm' ? ' · recommended' : ''}</option>)}
            </Select>
            {settings.video ? <Select label="Resolution" disabled={active} value={settings.quality} onChange={e => change({ quality: e.target.value })}><option value="480">480p · smallest</option><option value="720">720p · HD</option><option value="1080">1080p · Full HD</option></Select> : <Select label="Audio bitrate" disabled={active} value={settings.audioKbps} onChange={e => change({ audioKbps: +e.target.value })}><option value="48">48 kbps · speech / smallest</option><option value="64">64 kbps · clear voice</option><option value="96">96 kbps · balanced</option><option value="128">128 kbps · music</option><option value="192">192 kbps · high</option></Select>}
          </div>
          {settings.video && <div className="compression-picker" aria-label="Compression">{[['small', 'Small file'], ['balanced', 'Balanced'], ['high', 'High detail']].map(([id, label]) => <button key={id} aria-pressed={settings.compression === id} disabled={active} onClick={() => change({ compression: id })}>{label}</button>)}</div>}
          <div className="estimate"><div><span>Estimated size</span><b>{size(estimatedBytes(settings))}<small> / min</small></b></div><span className="estimate-hour">~{size(estimatedBytes(settings, 60))} / hour</span></div>
          <p className="help">{settings.video ? 'Lower bitrate and frame rate save space; small text may lose detail.' : 'WebM with Opus at 48 kbps is our smallest speech preset. MP3 export is in the Library.'} Estimates vary with content and Chrome’s encoder.</p>
          <button className="disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? '−' : '+'} More quality options <span>Frame rate · audio · formats</span></button>
          {advanced && <div className="advanced-panel">
            {settings.video && <div className="quality-grid"><Select label="Frame rate" disabled={active} value={settings.fps} onChange={e => change({ fps: +e.target.value })}><option value="15">15 fps · meetings</option><option value="24">24 fps · balanced</option><option value="30">30 fps · motion</option></Select><Select label="Audio bitrate" disabled={active || (!settings.microphone && !settings.tabAudio)} value={settings.audioKbps} onChange={e => change({ audioKbps: +e.target.value })}>{[48, 64, 96, 128, 192].map(rate => <option key={rate} value={rate}>{rate} kbps</option>)}</Select></div>}
            <div className="format-guide"><h4>Which format should I use?</h4><p><b>WebM</b> — compact recordings with efficient Opus audio.</p><p><b>MP4 / M4A</b> — familiar playback formats, when Chrome can encode them.</p><p><b>MKV</b> — offered only with a native Matroska encoder. A container alone does not make a file smaller.</p><p><b>MP3</b> — export audio-only recordings locally from the Library. Original media stays available.</p></div>
          </div>}
        </section>
        {(settings.microphone || settings.tabAudio) && <section className="audio-card"><div className="section-heading"><h3><Icon name="audio" size={15}/>Audio mix</h3><button className="text-button" onClick={() => chromeReady && chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') })}>Microphone access<Icon name="arrow" size={12}/></button></div>
          {settings.microphone && <div className="device-select"><Select label="Microphone device" disabled={active} value={settings.deviceId} onChange={e => change({ deviceId: e.target.value })}><option value="">Default microphone</option>{devices.filter(d => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone ' + (i + 1)}</option>)}{settings.deviceId && !devices.some(d => d.deviceId === settings.deviceId) && <option value={settings.deviceId}>Previously selected device (refresh to check)</option>}</Select><button className="icon-button" aria-label="Refresh microphones" disabled={active} onClick={refreshDevices}><Icon name="refresh" size={15}/></button></div>}
          {[[settings.microphone, 'micVolume', 'Microphone', 'microphone'], [settings.tabAudio, 'tabVolume', 'Tab audio', 'tabAudio']].filter(([enabled]) => enabled).map(([, key, label, source]) => <div className="volume-row" key={key}><div><label htmlFor={key}>{label}</label><span>{Math.round(settings[key] * 100)}%</span></div><input id={key} aria-label={label + ' recording volume'} type="range" disabled={active && !['recording', 'paused'].includes(state.status)} min="0" max="1.5" step="0.01" value={settings[key]} onChange={e => volume(key, +e.target.value)}/><div className="level-meter" aria-label={label + ' recording level'}><span style={{ width: (state.status === 'recording' ? (state.levels?.[source] || 0) * 100 : 0) + '%' }}/></div></div>)}
          <p className="help">Recording volume only. Tab playback stays audible. Use headphones to reduce microphone echo.</p>
        </section>}
        {storage?.quota && <p className={'storage-note ' + (storage.usage / storage.quota > .85 ? 'warning' : '')}><Icon name="file" size={12}/>{size(storage.usage)} local storage used · {size(Math.max(0, storage.quota - storage.usage))} estimated available</p>}
        <p className="privacy-note"><Icon name="shield" size={14}/><span>Get participant consent before recording. Captures this tab’s stream, not all system audio. Files stay on your device.</span></p>
      </> : <section className="library-view"><div className="library-heading"><div><h2>Your recordings</h2><p>Every conversation, kept on your device.</p></div><span className="library-total">{size(records.reduce((sum, r) => sum + r.bytes, 0))}</span></div><input className="search" type="search" placeholder="Search recordings…" aria-label="Search recordings" value={search} onChange={e => setSearch(e.target.value)}/>
        {!filtered.length && <div className="empty-state"><div><Icon name="library" size={29}/></div><h3>{records.length ? 'No matches' : 'Your first recording awaits'}</h3><p>{records.length ? 'Try a different recording name.' : 'Save a meeting or audio stream and find it here.'}</p>{!records.length && <button onClick={() => navigate('record')}>Open recorder<Icon name="arrow" size={14}/></button>}</div>}
        {filtered.map(record => {
          const recording = active && record.id === state.recordingId;
          const locked = busy || recording || exporting;
          return <article className="record-card" key={record.id}><div className="record-card-top"><div className={'record-kind ' + (record.mime.startsWith('audio/') ? 'audio-kind' : '')}><Icon name={record.mime.startsWith('video/') ? 'video' : 'audio'} size={20}/></div><div><h3>{record.name}</h3><p>{new Date(record.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p></div><span className="file-tag">{(record.extension || record.format).toUpperCase()}</span></div><div className="record-metadata"><span>{clock(record.duration)}</span><span>{size(record.bytes)}</span><span>{record.quality}</span>{record.audioKbps && <span>{record.audioKbps} kbps</span>}</div><p className="record-mode">{record.mode}</p>{record.status !== 'saved' && <p className="recovery-note">{recording ? 'Recording in progress…' : 'Interrupted recording · Download saved chunks to recover available media.'}</p>}
            <div className="record-actions"><button disabled={locked || !record.bytes} onClick={() => libraryAction(() => play(record))}><Icon name="play" size={13}/>Play</button><button disabled={locked || active || !record.bytes || !chromeReady} onClick={() => action('export', { id: record.id, format: 'original' })}><Icon name="download" size={13}/>Original</button>{record.mime.startsWith('audio/') && <button disabled={locked || active || !record.bytes || !chromeReady} onClick={() => action('export', { id: record.id, format: 'mp3' })}>MP3<Icon name="download" size={12}/></button>}<button className="text-button" disabled={locked} onClick={() => { setDialog({ type: 'rename', record }); setName(record.name); }}>Rename</button><button className="text-button danger" disabled={locked} onClick={() => setDialog({ type: 'delete', record })}>Delete</button></div>
          </article>;
        })}
        <p className="help library-help">MP3 conversion runs locally for audio-only recordings. Long recordings may exceed conversion memory limits; the original file is always available. Download before uninstalling the extension.</p>
      </section>}
    </div>
    <div className="action-dock">
      {view === 'record' ? <>{active ? <div className="session-actions"><button disabled={busy || !['recording', 'paused'].includes(state.status)} onClick={() => action(state.status === 'paused' ? 'resume' : 'pause')}><Icon name={state.status === 'paused' ? 'play' : 'pause'} size={17}/>{state.status === 'paused' ? 'Resume' : 'Pause'}</button><button className="stop-button" disabled={busy || !['recording', 'paused'].includes(state.status)} onClick={() => action('stop')}><Icon name="stop" size={15}/>Stop & save</button></div> : <button className="start-button" disabled={!chromeReady || busy || !loaded || exporting || !available || ![config.video, config.microphone, config.tabAudio].some(Boolean)} onClick={() => action('start')}><Icon name="record" size={20}/>{busy ? 'Starting…' : 'Start recording'}<span>{settings.video ? settings.quality + 'p' : 'Audio only'}</span></button>}<p>{active ? 'Recording continues when this popup closes.' : !available && loaded ? 'Select an available format before recording.' : 'Capture your tab. Keep it yours.'}</p></> : active ? <button className="active-session-button" onClick={() => navigate('record')}><span className="live-dot"/>{state.status === 'paused' ? 'Paused session' : 'Recording in progress'}<b>{clock(elapsed(state, now))}</b><Icon name="arrow" size={15}/></button> : <div className="library-footer"><Icon name="shield" size={15}/><span>No uploads. No account. Just your recordings.</span></div>}
    </div>
    {preview && <div className="modal-scrim"><section className="modal preview-modal" role="dialog" aria-modal="true" aria-label="Recording preview"><div className="modal-heading"><h2>{preview.record.name}</h2><button className="icon-button" aria-label="Close preview" onClick={closePreview}><Icon name="close"/></button></div>{preview.record.mime.startsWith('video/') ? <video src={preview.url} controls autoPlay/> : <audio src={preview.url} controls autoPlay/>}<p className="help">Some interrupted WebM files may not support seeking. Download the original to keep a copy.</p></section></div>}
    {dialog && <div className="modal-scrim"><form className="modal" role="dialog" aria-modal="true" aria-label={dialog.type === 'rename' ? 'Rename recording' : 'Delete recording'} onSubmit={e => { e.preventDefault(); const current = dialog; libraryAction(async () => { if (current.type === 'rename') { if (!name.trim()) return; await putRecording({ ...current.record, name: name.trim() }); } else await deleteRecording(current.record.id); setDialog(null); }); }}><h2>{dialog.type === 'rename' ? 'Make it easy to find' : 'Delete this recording?'}</h2>{dialog.type === 'rename' ? <input autoFocus aria-label="Recording name" value={name} maxLength="200" onChange={e => setName(e.target.value)}/> : <p>“{dialog.record.name}” will be permanently deleted from this device. Download a copy first if you need it.</p>}<div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className={dialog.type === 'delete' ? 'delete-confirm' : 'save-confirm'} disabled={busy || (dialog.type === 'rename' && !name.trim())}>{dialog.type === 'rename' ? 'Save name' : 'Delete recording'}</button></div></form></div>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
