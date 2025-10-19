import proto from './protocol-shim'
import { Thing, MudStorage } from './model'

export type PeerID = proto.PeerID

export class UserInfo {
  peerID: string
  name: string

  constructor(peerID: PeerID, name: string) {
    this.peerID = peerID
    this.name = name
  }
}

export interface IPeer {
  currentVersionID: string
  versionID: string

  init(app: any): void
  start(storage: MudStorage): void
  reset(): void
  connectString(): string
  relayConnectString(): string
  startHosting(): void
  joinSession(session: string): void
  startRelay(): void
  hostViaRelay(sessionID: string): void
  userThingChanged(thing: Thing): void
  command(cmd: string): void
}

const EMPTY_PEER: IPeer = {
  get currentVersionID(): string {
    throw new Error('Peer not connected')
  },
  get versionID(): string {
    throw new Error('Peer not connected')
  },
  init(app: any): void {
    throw new Error('Peer not connected')
  },
  start(storage: MudStorage): void {
    throw new Error('Peer not connected')
  },
  reset(): void {
    throw new Error('Peer not connected')
  },
  connectString(): string {
    throw new Error('Peer not connected')
  },
  relayConnectString(): string {
    throw new Error('Peer not connected')
  },
  startHosting(): void {
    throw new Error('Peer not connected')
  },
  joinSession(session: string): void {
    throw new Error('Peer not connected')
  },
  startRelay(): void {
    throw new Error('Peer not connected')
  },
  hostViaRelay(sessionID: string): void {
    throw new Error('Peer not connected')
  },
  userThingChanged(thing: Thing): void {
    throw new Error('Peer not connected')
  },
  command(cmd: string): void {
    throw new Error('Peer not connected')
  }
}

export let current: IPeer = EMPTY_PEER

export function setCurrent(peer: IPeer) {
  current = peer
}
