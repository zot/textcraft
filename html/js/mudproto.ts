// command protocol
//
// SIGNATURES
//   Sessions: start with a nonce
//   Message sequencing: NONCE.counter
//   Signed JSON: {json: text, signature: sig} -- text is NONCE,JSON
//

import {
    natTracker, roleTracker, peerTracker, sectionTracker, mudTracker,
    NatState, RoleState, PeerState, SectionState, MudState,
    assertUnreachable,
} from './base.js'
import proto from './protocol-shim.js'
import {
    promiseFor, MudStorage,
} from './model.js'
import * as gui from './gui.js'
import {
    activeWorld,
    MudConnection,
} from './mudcontrol.js'

const peerDbName = 'peer'
const textcraftProtocol = 'textcraft'
const callbackProtocol = 'textcraft-callback'
const relayProtocol = 'textcraft-relay'

let app: any
export let peer: Peer

export function init(appObj) {
    app = appObj
    console.log('Mudproto', proto)
}

const mudCommands = Object.freeze({
    // to source
    command: true,     // {text}
    // to peer
    output: true,      // {text}
    welcome: true,     // {users: [{peerID, name}...]}
    setUser: true,     // {peerID, name}
    removeUser: true,  // {peerID}
});

export class UserInfo {
    peerID: string
    name: string

    constructor(peerID: string, name: string) {
        this.peerID = peerID
        this.name = name
    }
}

// Peer
//
// Connects LoggingHandler -> TrackingHandler -> Peer -> CommandHandler -> strategy
//
// strategy starts out as an empty DeletaingHandler
//  -- peer swaps that depending on how the peer hosts or connects as a guest
//  -- Strategy:
//     HostStrategy:  DirectHostStrategy, IndirectHostStrategy
//     GuestStrategy: DirectGuestStrategy, RelayGuestStrategy, CallbackGuestStrategy
//
// At this point, only one type of connection is supported at a time (host or guest)
//
// Public-natted guests serve as relays for private-natted hosts
//
class Peer extends proto.DelegatingHandler<Strategy> {
    peerID: string
    peerAddrs: string[]
    storage: MudStorage
    trackingHandler: proto.TrackingHandler<Peer>
    strategy: Strategy
    peerDb: IDBObjectStore
    peerKey: string
    connections: any
    userMap: Map<string, UserInfo>

    constructor(storage: MudStorage) {
        super(null)
        peer = this
        this.connections = {}
        this.userMap = new Map()
        this.storage = storage
        this.trackingHandler = new proto.TrackingHandler<Peer>(this, this.connections);
        this.setStrategy(new Strategy())
        if ([...this.db().objectStoreNames].indexOf(peerDbName) === -1) {
            // tslint:disable-next-line:no-floating-promises
            this.createPeerDb()
        }
    }
    startHosting() {
        roleTracker.setValue(RoleState.Host)
        if (natTracker.value === NatState.Public) {
            const strategy = new DirectHostStrategy()

            this.setStrategy(strategy)
            strategy.start()
        }
        sectionTracker.setValue(SectionState.Connection)
    }
    joinSession(sessionID: string) {
        if (!sessionID) {
            throw new Error('Enter a session ID to join')
        }
        console.log('JOIN', decodeObject(sessionID))
        const strategy = new DirectGuestStrategy(decodeObject(sessionID))

        this.setStrategy(strategy)
        strategy.start()
    }
    setStrategy(strat: Strategy) {
        this.delegate = this.strategy = strat
    }
    setUser(peerID: string, user: UserInfo) {
        this.userMap.set(peerID, user)
    }
    removeUser(peerID: string) {
        this.userMap.delete(peerID)
    }
    sendCommand(text: string) {
        this.strategy.sendCommand(text)
    }
    showUsers() {
        gui.showUsers(this.userMap)
    }
    start() {
        const url = "ws://"+document.location.host+"/";

        console.log("STARTING MUDPROTO");
        proto.startProtocol(url + "libp2p", new proto.LoggingHandler<any>(this.trackingHandler));
    }
    db() {
        return this.storage.db
    }
    doTransaction(func: (db: IDBObjectStore)=>void) {
        if (this.peerDb) {
            return Promise.resolve(func(this.peerDb))
        } else {
            return new Promise((succeed, fail)=> {
                const txn = this.db().transaction([peerDbName], 'readwrite')

                this.peerDb = txn.objectStore(peerDbName)
                txn.oncomplete = ()=> {
                    this.peerDb = null
                    succeed()
                }
                txn.onabort = ()=> {
                    this.peerDb = null
                    fail()
                }
                txn.onerror = ()=> {
                    this.peerDb = null
                    fail()
                }
            })
        }
    }
    createPeerDb() {
        return new Promise((succeed, fail)=> {
            const req = this.storage.upgrade(()=> {
                return this.doTransaction((peerDb)=> {
                    this.store()
                })
            })

            req.onupgradeneeded = ()=> {
                req.transaction.db.createObjectStore(peerDbName, {keyPath: 'id'})
            }
            req.onerror = fail
        })
    }
    store() {
        this.peerDb.put({
            id: 'peerInfo',
            peerKey: this.peerKey
        })
    }
    async load() {
        const info = (await promiseFor(this.peerDb.get('peerInfo'))) as any

        this.peerKey = info.peerKey
    }
    reset() {
        peerTracker.setValue(PeerState.disconnected)
        if (roleTracker.value !== RoleState.None) {
            roleTracker.setValue(RoleState.Solo)
        }
        this.strategy.close()
        this.setStrategy(new Strategy())
        gui.noConnection()
    }
    // P2P API
    hello(started) {
        console.log('RECEIVED HELLO')
        if (started) {
            console.log('Peer already started')
        } else {
            console.log('Starting peer...')
            proto.start(this.peerKey || '')
        }
    }
    // P2P API
    async ident(status, peerID, addresses, peerKey) {
        console.log('PEER CONNECTED')
        this.peerID = peerID
        this.peerKey = peerKey
        natTracker.setValueNamed(status)
        gui.setPeerId(peerID)
        console.log('IDENT: ', peerID, ' ', status)
        this.peerAddrs = addresses;
        this.reset();
        await this.doTransaction(()=> this.store())
        super.ident(status, peerID, addresses, peerKey)
    }
}

class Strategy extends proto.CommandHandler<any> {
    abort: boolean

    constructor() {
        super(null, peer.connections, mudCommands, null, [])
    }
    sendObject(conID: proto.ConID, obj: any) {
        proto.sendObject(conID, obj);
    }
    close() {}
    sendCommand(text: string) {
        throw new Error(`This connection cannot send commands`)
    }
}

class HostStrategy extends Strategy {
    sessionID: any
    hosting: Map<number, any>                              // conID -> {conID, peerID, protocol}
    mudConnections: Map<string, MudConnection>  // peerID -> connection

    constructor() {
        super()
        this.hosting = new Map()
        this.mudConnections = new Map()
    }
    close() {
        for (const con of this.mudConnections.values()) {
            // tslint:disable-next-line:no-floating-promises
            con.close()
        }
        this.mudConnections = null
        this.hosting = null
        this.sessionID = null
    }
    playerLeft(peerID: string) {
        // tslint:disable-next-line:no-floating-promises
        this.mudConnections.get(peerID).close()
        this.mudConnections.delete(peerID)
    }
    newPlayer(conID: number, peerID: string, protocol: string) {
        const users = []
        const mudcon = new MudConnection(activeWorld, text=> this.sendObject(conID, {
            name: 'output',
            hostID: peer.peerID,
            text,
        }))

        console.log("Got connection "+conID+" for protocol "+protocol+" from peer "+peerID)
        this.hosting.set(conID, {conID, peerID, protocol})
        for (const [pid, con] of this.mudConnections) {
            users.push({peerID: pid, user: con.thing.name})
        }
        this.sendObject(conID, {name: 'welcome', users})
        this.mudConnections.set(peerID, mudcon)
        // tslint:disable-next-line:no-floating-promises
        mudcon.doLogin(peerID, null, true)
        peer.showUsers()
    }
    // mud API message
    async command(info, {text}) {
        return this.mudConnections.get(info.peerID).command(text)
    }
}

class GuestStrategy extends Strategy {
    mudHost: proto.PeerID
    mudConnection: proto.ConID
    mudProtocol: string
    hostAddrs: string[]

    constructor(mudHost: string, hostAddrs: string[], protocol: string) {
        super()
        this.mudHost = mudHost
        this.mudProtocol = protocol
        this.hostAddrs = hostAddrs
    }
    sendCommand(text: string) {
        this.sendObject(this.mudConnection, {name: 'command', text})
    }
    close() {
        if (this.mudConnection !== null) {
            proto.close(this.mudConnection)
            this.mudConnection = null
        }
    }
    isConnectedToHost() {
        return peerTracker.value === PeerState.connectedToHost
    }
    connectedToHost(conID, protocol, peerID) {
        roleTracker.setValue(RoleState.Guest)
        gui.connectedToHost(peerID)
    }
    // P2P API
    peerConnection(conID, peerID, protocol) {
        if (protocol === this.mudProtocol) {
            this.mudConnection = conID
        }
        super.peerConnection(conID, peerID, protocol)
    }
    // P2P API
    peerConnectionRefused(peerID, prot, msg) {
        peer.reset()
        gui.connectionRefused(peerID, prot, msg)
    }
    // P2P API
    connectionClosed(conID: number, msg: string) {
        if (this.mudConnection === conID) {
            peer.reset();
        }
        super.connectionClosed(conID, msg);
    }
    // mud API message
    output(info, {text}) {
        gui.addMudOutput(text)
    }
    // mud API message
    welcome(info, {users}) {
        peer.userMap = new Map()
        for (const {peerID, user} of users) {
            peer.userMap.set(peerID, new UserInfo(peerID, user))
        }
        peer.showUsers()
    }
    // mud API message
    setUser(info, msg) {
    }
    // mud API message
    removeUser(info, msg) {
    }
}

class DirectHostStrategy extends HostStrategy {
    protocol: string

    close() {
        if (this.mudConnections) {
            proto.stop(this.protocol, false)
        }
        super.close()
    }
    start() {
        let protocol = textcraftProtocol + '-'
        const a = 'a'.charCodeAt(0)
        const A = 'A'.charCodeAt(0)

        for (let i = 0; i < 16; i++) {
            const n = Math.round(Math.random() * 51)

            protocol += String.fromCharCode(n < 26 ? a + n : A + n - 26)
        }
        this.sessionID = {
            type: 'peerAddr',
            peerID: this.connections.peerID,
            protocol,
            addrs: peer.peerAddrs
        };
        this.protocol = protocol
        this.protocols.add(protocol)
        peerTracker.setValue(PeerState.startingHosting)
        proto.listen(this.protocol, true)
    }
    // P2P API
    listening(protocol) {
        if (protocol === this.protocol) {
            this.sessionID = {
                type: 'peerAddr',
                peerID: peer.peerID,
                protocol: this.protocol,
                addrs: peer.peerAddrs
            };

            gui.setConnectString(encodeObject(this.sessionID))
            console.log('SessionID', decodeObject(encodeObject(this.sessionID)))
            roleTracker.setValue(RoleState.Host)
            peerTracker.setValue(PeerState.hostingDirectly)
        }
        super.listening(protocol);
    }
    // P2P API
    listenerConnection(conID: number, peerID: string, protocol: string) {
        if (protocol === this.protocol) {
            this.newPlayer(conID, peerID, protocol)
        }
        super.listenerConnection(conID, peerID, protocol)
    }
    // P2P API
    connectionClosed(conID, msg) {
        const con = this.hosting.get(conID)

        if (con) {
            this.hosting.delete(conID)
            peer.removeUser(con.peerID)
            for (const [id, hcon] of this.hosting) {
                if (id !== conID) {
                    this.sendObject(id, {
                        name: 'removeUser',
                        peerID: con.peerID,
                    })
                }
            }
            peer.showUsers()
        }
        super.connectionClosed(conID, msg);
    }
    // P2P API
    listenerClosed(protocol) {
        if (protocol === this.protocol) {
            peer.reset();
        }
        super.listenerClosed(protocol);
    }
}

class RelayedHostStrategy extends HostStrategy {
    callbackRelayConID: number

    abortCallback() {
        proto.stop(callbackProtocol, false)
        proto.close(this.callbackRelayConID)
        peer.reset()
    }
}

class DirectGuestStrategy extends GuestStrategy {
    constructor({peerID, addrs, protocol}: any) {
        super(peerID, addrs, protocol)
        this.protocols.add(protocol)
    }
    start() {
        peerTracker.setValue(PeerState.connectingToHost)
        proto.connect(encodePeerId(this.mudHost, this.hostAddrs), this.mudProtocol, true);
    }
    // P2P API
    peerConnection(conID, peerID, protocol) {
        super.peerConnection(conID, peerID, protocol);
        switch (peerTracker.value) {
            case PeerState.connectingToHost: // connected directly to host
                if (peerID !== this.mudHost) {
                    alert('Connected to unexpected host: '+peerID);
                } else {
                    peerTracker.setValue(PeerState.connectedToHost);
                    roleTracker.setValue(RoleState.Guest)
                    mudTracker.setValue(MudState.Playing)
                    this.connectedToHost(conID, protocol, peerID);
                }
                break;
            default:
                throw new Error(`Illegal peer state: ${peerTracker.currentStateName()}`)
                break;
        }
    }
}

class RelayGuestStrategy extends GuestStrategy {
    constructor(mudHost: string) {
        super(mudHost, null, null)
    }
}

class CallbackGuestStrategy extends GuestStrategy {
    callbackPeer: string

    constructor(mudHost: string) {
        super(mudHost, null, null)
    }
    // P2P API
    listenerConnection(conID: proto.ConID, peerID: proto.PeerID, protocol: string) {
        if (protocol === callbackProtocol) { // got a callback, verify token later
            if (peerTracker.value !== PeerState.awaitingTokenConnection || peerID !== this.callbackPeer) {
                proto.connectionError(conID, proto.errors.badCallback, 'Unexpected callback peer', true)
                return
            } else if (this.abort) {
                peer.reset()
                return
            }
            peerTracker.setValue(PeerState.awaitingToken)
        }
        super.listenerConnection(conID, peerID, protocol)
    }
}

function encodePeerId(peerID, addrs) {
    return '/addrs/'+proto.encode_ascii85(JSON.stringify({peerID, addrs}));
}

function encodeObject(obj: any) {
        return proto.encode_ascii85(JSON.stringify(obj));
}

function decodeObject(str) {
    try {
        return JSON.parse(proto.decode_ascii85(str));
    } catch (err) {
        return null;
    }
}

export function start(storage: MudStorage) {
    peer = new Peer(storage)
    natTracker.setValue(NatState.Unknown)
    peer.start()
}

export function startHosting() {
    peer?.startHosting()
}

export function joinSession(sessionID: string) {
    peer?.reset()
    peer?.joinSession(sessionID)
}

export function reset() {
    peer?.reset()
}

export function directConnectString() {
    return peer?.strategy instanceof DirectHostStrategy && encodeObject(peer.strategy.sessionID)
}

export function command(text: string) {
    peer?.sendCommand(text)
}
