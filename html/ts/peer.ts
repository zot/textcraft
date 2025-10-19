import proto from './protocol-shim'
import { Thing, MudStorage } from './model'

/**
 * Type alias for peer identifiers used in the P2P network.
 * These IDs uniquely identify each peer in the libp2p network.
 */
export type PeerID = proto.PeerID

/**
 * Represents user information for a connected peer in the MUD.
 * Maps a peer's network ID to their in-game character name.
 */
export class UserInfo {
  /** The libp2p peer ID for this user */
  peerID: string
  /** The user's current character name in the MUD */
  name: string

  constructor(peerID: PeerID, name: string) {
    this.peerID = peerID
    this.name = name
  }
}

/**
 * Interface for P2P networking peers in Textcraft.
 *
 * This abstraction allows the MUD to work with different P2P strategies:
 * - Host: Manages the authoritative MUD state and serves guests
 * - Guest: Connects to a host and sends commands
 * - Relay: Acts as a NAT traversal relay for peers behind firewalls
 *
 * The peer system handles:
 * - P2P connection establishment (direct or via relay)
 * - User synchronization across the network
 * - Command routing between peers
 * - Version compatibility checking
 */
export interface IPeer {
  /** Current protocol/storage version ID for this peer */
  currentVersionID: string
  /** Expected version ID for compatibility checking */
  versionID: string

  /**
   * Initialize the peer with application context.
   * Sets up event handlers and prepares the peer for networking.
   *
   * @param app - Application state object containing GUI and state management
   */
  init(app: any): void

  /**
   * Start the peer with MUD storage context.
   * Begins listening for connections or prepares to connect to other peers.
   *
   * @param storage - MudStorage instance for persistence and state management
   */
  start(storage: MudStorage): void

  /**
   * Reset the peer to initial state.
   * Disconnects from all peers and clears network state.
   */
  reset(): void

  /**
   * Get the connection string for direct P2P connections.
   * Other peers can use this string to connect directly to this peer.
   *
   * @returns Multiaddr connection string (e.g., "/ip4/192.168.1.1/tcp/9090/p2p/QmXXX...")
   */
  connectString(): string

  /**
   * Get the connection string for relay-based connections.
   * Used when direct connections fail due to NAT/firewall restrictions.
   *
   * @returns Relay multiaddr connection string
   */
  relayConnectString(): string

  /**
   * Start hosting a MUD session.
   * Makes this peer the authoritative source for the MUD world state.
   * Guests will connect to this peer to interact with the MUD.
   */
  startHosting(): void

  /**
   * Join an existing MUD session as a guest.
   * Connects to a host peer using their connection string.
   *
   * @param session - Connection string from the host (direct or relay multiaddr)
   */
  joinSession(session: string): void

  /**
   * Start operating as a relay server.
   * Relay servers help peers behind NATs/firewalls connect to each other
   * by forwarding traffic between them.
   */
  startRelay(): void

  /**
   * Host a MUD session via a relay server.
   * Used when this peer is behind a NAT/firewall and cannot accept
   * direct incoming connections.
   *
   * @param sessionID - The relay server's session identifier
   */
  hostViaRelay(sessionID: string): void

  /**
   * Notify the network that a user's Thing (character) has changed.
   *
   * This is called when a user's in-game character is modified, particularly
   * when their name changes. Only hosts propagate these changes to guests.
   *
   * Workflow (host only):
   * 1. Maps the Thing to its peer ID
   * 2. Updates internal user map with new name
   * 3. Broadcasts 'setUser' command to all connected guests
   * 4. In relay mode, also notifies the relay server
   *
   * @param thing - The Thing (character) that was modified
   */
  userThingChanged(thing: Thing): void

  /**
   * Execute a MUD command from this peer.
   *
   * - For guests: Sends the command to the host for execution
   * - For hosts: Routes the command to the appropriate guest's MudControl
   *
   * @param cmd - Command text to execute (e.g., "look", "say hello", "@create sword")
   */
  command(cmd: string): void
}

/**
 * Placeholder peer implementation that throws errors on all operations.
 *
 * This serves as the initial state before a real peer is created and set.
 * Attempting to use peer operations before initialization will throw
 * descriptive errors rather than causing undefined behavior.
 */
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

/**
 * The currently active peer instance.
 *
 * This is set by mudproto.ts when a concrete peer implementation is created
 * (e.g., MudProtoPeer). Components throughout the application can import and
 * use this singleton to access P2P networking functionality.
 *
 * Initial value is EMPTY_PEER which throws errors until a real peer is set.
 */
export let current: IPeer = EMPTY_PEER

/**
 * Set the active peer instance.
 *
 * Called by mudproto.ts during peer initialization to replace EMPTY_PEER
 * with a fully functional peer implementation.
 *
 * @param peer - The peer instance to set as current
 */
export function setCurrent(peer: IPeer) {
  current = peer
}
