/**
 * The bridge.
 *
 * Everything the renderer can reach passes through here, and `ipcRenderer` itself never does.
 * Exposing it directly — even "just for now" — would give any script running in the renderer
 * the ability to invoke every channel in the main process, which defeats the whole arrangement.
 *
 * Compiled to CommonJS as `preload.cjs`, because a sandboxed preload must be CJS. That is the
 * only reason for the separate build step, and `sandbox: true` is worth it.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { BRIDGE_KEY, CHANNEL, type OfficeApi } from '../shared/ipc.js'

/** Subscribe, and hand back the unsubscribe. A listener with no way off is a leak. */
function on<T>(channel: string, callback: (project: string, payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, project: string, payload: T) => callback(project, payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/** The same, for a channel that carries no project. */
function onPlain<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: OfficeApi = {
  describe: () => ipcRenderer.invoke(CHANNEL.describe),
  onOffice: (callback) => onPlain(CHANNEL.office, callback),
  onSessions: (callback) => onPlain(CHANNEL.sessionList, callback),
  onSessionMode: (callback) => onPlain(CHANNEL.sessionMode, callback),
  setMode: (project, mode) => ipcRenderer.invoke(CHANNEL.setMode, project, mode),
  sprites: (agentName) => ipcRenderer.invoke(CHANNEL.sprites, agentName),
  send: (project, session, text) => ipcRenderer.invoke(CHANNEL.send, project, session, text),
  interrupt: (project, session) => ipcRenderer.invoke(CHANNEL.interrupt, project, session),
  onEvent: (callback) => on(CHANNEL.event, callback),
  onSessionState: (callback) => on(CHANNEL.state, callback),
  askAbout: (project, agent, question) => ipcRenderer.invoke(CHANNEL.aside, project, agent, question),
  restore: (project, session) => ipcRenderer.invoke(CHANNEL.restore, project, session),
  createProject: (name) => ipcRenderer.invoke(CHANNEL.createProject, name),
  describeProject: (id) => ipcRenderer.invoke(CHANNEL.describeProject, id),
  closeSession: (project, id) => ipcRenderer.invoke(CHANNEL.closeSession, project, id),
  archiveProject: (id) => ipcRenderer.invoke(CHANNEL.archiveProject, id),
  deleteProject: (id) => ipcRenderer.invoke(CHANNEL.deleteProject, id),
  workOf: (project, agent) => ipcRenderer.invoke(CHANNEL.work, project, agent),
  setTheme: (id) => ipcRenderer.invoke(CHANNEL.theme, id),
  commandsOf: () => ipcRenderer.invoke(CHANNEL.commands),
  hire: (request) => ipcRenderer.invoke(CHANNEL.hire, request),
  fireAgent: (id) => ipcRenderer.invoke(CHANNEL.fireAgent, id),
  disableAgent: (id) => ipcRenderer.invoke(CHANNEL.disableAgent, id),
  enableAgent: (id) => ipcRenderer.invoke(CHANNEL.enableAgent, id),
  benched: () => ipcRenderer.invoke(CHANNEL.benched),
  addSkill: (skill) => ipcRenderer.invoke(CHANNEL.addSkill, skill),
  removeSkill: (id) => ipcRenderer.invoke(CHANNEL.removeSkill, id),
  shelf: (project) => ipcRenderer.invoke(CHANNEL.shelf, project),
  memory: () => ipcRenderer.invoke(CHANNEL.memory),
  decided: () => ipcRenderer.invoke(CHANNEL.decided),
  changed: () => ipcRenderer.invoke(CHANNEL.changed),
  search: (query) => ipcRenderer.invoke(CHANNEL.search, query),
  undo: (dispatch) => ipcRenderer.invoke(CHANNEL.undo, dispatch),
  addProjectTemplate: () => ipcRenderer.invoke(CHANNEL.addTemplate),
  hooks: () => ipcRenderer.invoke(CHANNEL.hooks),
  planUsage: () => ipcRenderer.invoke(CHANNEL.planUsage),
  maintainedElsewhere: (look) => ipcRenderer.invoke(CHANNEL.maintainedElsewhere, look),
  offeredBy: (at, kind) => ipcRenderer.invoke(CHANNEL.offeredBy, at, kind),
  hireFromSource: (at, kind, id) => ipcRenderer.invoke(CHANNEL.hireFromSource, at, kind, id),
  takeTheirVersion: (id) => ipcRenderer.invoke(CHANNEL.takeTheirVersion, id),
  connectService: (request) => ipcRenderer.invoke(CHANNEL.connectService, request),
  disconnectService: (name) => ipcRenderer.invoke(CHANNEL.disconnectService, name),
  projectServers: () => ipcRenderer.invoke(CHANNEL.projectServers),
  whatWouldBeShared: () => ipcRenderer.invoke(CHANNEL.whatWouldBeShared),
  capabilitiesOf: () => ipcRenderer.invoke(CHANNEL.capabilities),
  recheck: () => ipcRenderer.invoke(CHANNEL.recheck),
  privacyOf: (project) => ipcRenderer.invoke(CHANNEL.privacy, project),

  musicPlayer: () => ipcRenderer.invoke(CHANNEL.musicPlayer),
  musicConnect: () => ipcRenderer.invoke(CHANNEL.musicConnect),
  musicDisconnect: () => ipcRenderer.invoke(CHANNEL.musicDisconnect),
  musicCommand: (what, deviceId) => ipcRenderer.invoke(CHANNEL.musicCommand, what, deviceId),
  musicTransfer: (deviceId, play) => ipcRenderer.invoke(CHANNEL.musicTransfer, deviceId, play),
  musicSearch: (query) => ipcRenderer.invoke(CHANNEL.musicSearch, query),
  musicPlayTrack: (uri, deviceId) => ipcRenderer.invoke(CHANNEL.musicPlayTrack, uri, deviceId),
  musicSetup: () => ipcRenderer.invoke(CHANNEL.musicSetup),
  musicSetClientId: (clientId) => ipcRenderer.invoke(CHANNEL.musicSetClientId, clientId),
  musicSetNetwork: (allowed) => ipcRenderer.invoke(CHANNEL.musicSetNetwork, allowed),
  forget: (path) => ipcRenderer.invoke(CHANNEL.forget, path),
  controlsOf: (project) => ipcRenderer.invoke(CHANNEL.controlsOf, project),
  unfinishedWork: () => ipcRenderer.invoke(CHANNEL.unfinished),
  dropDispatch: (id) => ipcRenderer.invoke(CHANNEL.dropDispatch, id),
  retryDispatch: (id) => ipcRenderer.invoke(CHANNEL.retryDispatch, id),
  // Subscribing is also asking. The watcher pushes only when the held set changes, and its first
  // push goes out before this window exists — so a call already held when the office opened was
  // never shown. Subscribed first, so the answer cannot arrive ahead of the listener.
  onApprovals: (callback) => {
    const off = onPlain(CHANNEL.approvals, callback)
    void ipcRenderer.invoke(CHANNEL.approvalsResend)
    return off
  },
  decide: (sessionId, toolUseId, allow, reason) =>
    ipcRenderer.invoke(CHANNEL.decide, sessionId, toolUseId, allow, reason),
  setControls: (project, controls) => ipcRenderer.invoke(CHANNEL.setControls, project, controls),
  sessionsOf: (project) => ipcRenderer.invoke(CHANNEL.sessions, project),
  openSession: (project, id) => ipcRenderer.invoke(CHANNEL.openSession, project, id),
  openAgentSession: (project, agent) => ipcRenderer.invoke(CHANNEL.openAgentSession, project, agent),
  tasksOf: (project) => ipcRenderer.invoke(CHANNEL.tasks, project),
  verify: (project, only, force) => ipcRenderer.invoke(CHANNEL.verify, project, only, force),
  setVoice: (on) => ipcRenderer.invoke(CHANNEL.voice, on),
  onSpeak: (callback) => onPlain(CHANNEL.speak, callback),
  dictation: () => ipcRenderer.invoke(CHANNEL.dictation),
  // The audio crosses as a plain ArrayBuffer, which the structured clone moves rather than
  // stringifies. A base64 round trip would be a third again in size for a payload that is already
  // the largest thing this bridge carries.
  transcribe: (wav) => ipcRenderer.invoke(CHANNEL.transcribe, wav),
  fetchDictationModel: () => ipcRenderer.invoke(CHANNEL.dictationModel),
  installDictation: () => ipcRenderer.invoke(CHANNEL.dictationInstall),
  microphoneAccess: () => ipcRenderer.invoke(CHANNEL.micAccess),
}

contextBridge.exposeInMainWorld(BRIDGE_KEY, api)
