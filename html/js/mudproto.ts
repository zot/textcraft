// command protocol
//
// SIGNATURES
//   Sessions: start with a nonce
//   Message sequencing: NONCE.counter
//   Signed JSON: {json: text, signature: sig} -- text is NONCE,JSON
//

import {
    natTracker, roleTracker, peerTracker, sectionTracker,
    NatState, RoleState, PeerState, SectionState,
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

var app: any
export var peer: Peer

export function init(appObj) {
    app = appObj
    console.log('Mudproto', proto)
}

const mudCommands = Object.freeze({
    // to source
    command: true,     // text: command
    // to peer
    output: true,      // text: output
    welcome: true,     // users: [{pubkey: pubKey, name: name}...]
    setUser: true,     // peerID: peerID, name: name OR pubkey: pubkey, name: name
    removeUser: true,  // user: peerID
});

export class UserInfo {
    peerID: string
    name: string
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
        this.connections = {}
        this.storage = storage
        if ([...this.db().objectStoreNames].indexOf(peerDbName) == -1) {
            this.createPeerDb()
        }
        this.trackingHandler = new proto.TrackingHandler<Peer>(this, this.connections);
        this.setStrategy(new Strategy(this))
    }
    startHosting() {
        roleTracker.setValue(RoleState.Host)
        if (natTracker.value == NatState.Public) {
            var strategy = new DirectHostStrategy(this)

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
    showUsers() {
        var users = [...this.userMap.values()]

        users.sort((a, b)=> a.name == b.name ? 0 : a.name < b.name ? -1 : 1)
        gui.showUsers(users)
    }
    start() {
        var url = "ws://"+document.location.host+"/";

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
                var txn = this.db().transaction([peerDbName], 'readwrite')

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
            var req = this.storage.upgrade(()=> {
                this.doTransaction((peerDb)=> {
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
        var info = (await promiseFor(this.peerDb.get('peerInfo'))) as any

        this.peerKey = info.peerKey
    }
    reset() {
        peerTracker.setValue(PeerState.disconnected)
        this.strategy.close()
        this.setStrategy(new Strategy(this))
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

    constructor(peer: Peer) {
        super(null, peer.connections, mudCommands, null, [])
    }
    sendObject(conID: proto.ConID, obj: any) {
        proto.sendObject(conID, obj);
    }
    close() {}
}

class HostStrategy extends Strategy {
    sessionID: any
    hosting: Map<number, any>                              // conID -> {conID, peerID, protocol}
    mudConnections: Map<string, MudConnection>  // peerID -> connection

    constructor(peer: Peer) {
        super(peer)
        this.hosting = new Map()
        this.mudConnections = new Map()
    }
    close() {
        for (let con of this.mudConnections.values()) {
            con.close()
        }
        this.mudConnections = null
        this.hosting = null
        this.sessionID = null
    }
    // P2P API
    listenerConnection(conID: number, peerID: string, protocol: string) {
        super.listenerConnection(conID, peerID, protocol)
        this.mudConnections.set(peerID, new MudConnection(activeWorld, text=> {
            this.sendObject(conID, {text})
        }))
    }
    // chat API message
    command(info, msg) {}
}

class GuestStrategy extends Strategy {
    chatHost: proto.PeerID
    chatConnection: proto.ConID

    constructor(peer: Peer, chatHost: string) {
        super(peer)
        this.chatHost = chatHost
    }
    close() {
        if (this.chatConnection != null) {
            proto.close(this.chatConnection)
            this.chatConnection = null
        }
    }
    isConnectedToHost() {
        return peerTracker.value == PeerState.connectedToHost
    }
    connectedToHost(conID, protocol, peerID) {
        roleTracker.setValue(RoleState.Guest)
        gui.connectedToHost(peerID)
        this.sendObject(conID, {name: 'user', peer: peer.peerID});
    }
    // P2P API
    peerConnectionRefused(peerID, prot, msg) {
        peer.reset()
        gui.connectionRefused(peerID, prot, msg)
    }
    // P2P API
    connectionClosed(conID: number, msg: string) {
        if (this.chatConnection == conID) {
            peer.reset();
        }
        super.connectionClosed(conID, msg);
    }
    // chat API message
    output(info, msg) {
    }
    // chat API message
    welcome(info, msg) {
    }
    // chat API message
    setUser(info, msg) {
    }
    // chat API message
    removeUser(info, msg) {
    }
}

class DirectHostStrategy extends HostStrategy {
    protocol: string

    constructor(peer: Peer) {
        super(peer)
    }
    close() {
        if (this.mudConnections) {
            proto.stop(this.protocol, false)
        }
        super.close()
    }
    start() {
        var protocol = textcraftProtocol + '-'
        var a = 'a'.charCodeAt(0)
        var A = 'A'.charCodeAt(0)

        for (var i = 0; i < 16; i++) {
            var n = Math.round(Math.random() * 51)

            protocol += String.fromCharCode(n < 26 ? a + n : A + n - 26)
        }
        this.sessionID = {
            type: 'peerAddr',
            peerID: this.connections.peerID,
            protocol: protocol,
            addrs: peer.peerAddrs
        };
        this.protocol = protocol
        this.protocols.add(protocol)
        peerTracker.setValue(PeerState.startingHosting)
        proto.listen(this.protocol, true)
    }
    // P2P API
    listening(protocol) {
        if (protocol == this.protocol) {
            this.sessionID = {
                type: 'peerAddr',
                peerID: peer.peerID,
                protocol: this.protocol,
                addrs: peer.peerAddrs
            };

            gui.setConnectString(encodeObject(this.sessionID))
            roleTracker.setValue(RoleState.Host)
            peerTracker.setValue(PeerState.hostingDirectly)
        }
        super.listening(protocol);
    }
    // P2P API
    listenerConnection(conID: number, peerID: string, protocol: string) {
        if (protocol == this.protocol) {
            var users = []

            console.log("Got connection "+conID+" for protocol "+protocol+" from peer "+peerID)
            this.hosting.set(conID, {conID, peerID, protocol})
        }
        super.listenerConnection(conID, peerID, protocol)
    }
    // P2P API
    connectionClosed(conID, msg) {
        var con = this.hosting.get(conID)

        if (con) {
            this.hosting.delete(conID)
            peer.removeUser(con.peerID)
            for (var [id, con] of this.hosting) {
                if (id != conID) {
                    this.sendObject(id, {name: 'removeUser', peerID: con.peerID})
                }
            }
            peer.showUsers()
        }
        super.connectionClosed(conID, msg);
    }
    // P2P API
    listenerClosed(protocol) {
        if (protocol == this.protocol) {
            peer.reset();
        }
        super.listenerClosed(protocol);
    }
}

class RelayedHostStrategy extends HostStrategy {
    callbackRelayConID: number

    constructor(peer: Peer) {
        super(peer)
    }
    abortCallback() {
        proto.stop(callbackProtocol, false)
        proto.close(this.callbackRelayConID)
        peer.reset()
    }
}

class DirectGuestStrategy extends GuestStrategy {
    constructor(peer: Peer, chatHost: string) {
        super(peer, chatHost)
    }
    // P2P API
    peerConnection(conID, peerID, protocol) {
        super.peerConnection(conID, peerID, protocol);
        switch (peerTracker.value) {
            case PeerState.connectingToHost: // connected directly to host
                if (peerID != this.chatHost) {
                    alert('Connected to unexpected host: '+peerID);
                } else {
                    peerTracker.setValue(PeerState.connectedToHost);
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
    constructor(peer: Peer, chatHost: string) {
        super(peer, chatHost)
    }
}

class CallbackGuestStrategy extends GuestStrategy {
    callbackPeer: string

    constructor(peer: Peer, chatHost: string) {
        super(peer, chatHost)
    }
    // P2P API
    listenerConnection(conID, peerID, prot) {
        if (prot == callbackProtocol) { // got a callback, verify token later
            if (peerTracker.value != PeerState.awaitingTokenConnection || peerID != this.callbackPeer) {
                proto.connectionError(conID, proto.relayErrors.badCallback, 'Unexpected callback peer', true)
                return
            } else if (this.abort) {
                peer.reset()
                return
            }
            peerTracker.setValue(PeerState.awaitingToken)
        }
        super.listenerConnection(conID, peerID, prot)
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

export function directConnectString() {
    return peer?.strategy instanceof DirectHostStrategy && encodeObject(peer.strategy.sessionID)
}
