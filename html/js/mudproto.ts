// command protocol
//
// SIGNATURES
//   Sessions: start with a nonce
//   Message sequencing: NONCE.counter
//   Signed JSON: {json: text, signature: sig} -- text is NONCE,JSON
//

import {
    natTracker, roleTracker, peerTracker,
    NatState, RoleState, PeerState,
} from './base.js'
import proto from './protocol-shim.js'
import {
    promiseFor, MudStorage,
} from './model.js'
import * as gui from './gui.js'
import * as mudcontrol from './mudcontrol.js'

const peerDbName = 'peer'
const textcraftProtocol = 'textcraft'
const callbackProtocol = 'textcraft-callback'
const relayProtocol = 'textcraft-relay'

var app: any
var peer: Peer

export function init(appObj) {
    app = appObj
    console.log('Mudproto', proto)
}

const mudCommands = Object.freeze({
    command: true,     // text: command
    output: true,      // text: output
    // to host
    user: true,        // pubkey: publicKey
    // to peer
    welcome: true,     // users: [{user: pubkey, name: name}...]
    updateUser: true,  // user: pubkey, name: name
    addUser: true,     // user: pubkey, name: name
    removeUser: true,  // user: pubkey
});

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
class Peer extends proto.DelegatingHandler<MudCommands> {
    peerID: string
    peerAddrs: string[]
    storage: MudStorage
    trackingHandler: proto.TrackingHandler<Peer>
    commandHandler: MudCommands
    strategy: Strategy
    peerDb: IDBObjectStore
    peerKey: string
    connections: any

    constructor(storage: MudStorage) {
        super(null)
        this.connections = {}
        this.storage = storage
        if ([...this.db().objectStoreNames].indexOf(peerDbName) == -1) {
            this.createPeerDb()
        }
        this.trackingHandler = new proto.TrackingHandler<Peer>(this, this.connections);
        this.commandHandler = new MudCommands(null)
        this.delegate = this.commandHandler
        this.setStrategy(new EmptyStrategy())
    }
    setStrategy(strat: Strategy) {
        this.strategy = strat
        this.commandHandler.delegate = strat
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
        //// TODO
    }
    abortStrategy() {
        this.strategy.aborted()
        this.setStrategy(new EmptyStrategy)
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

abstract class Strategy extends proto.DelegatingHandler<any> {
    abort: boolean

    abstract aborted()

    constructor(delegate: proto.P2pHandler) {
        super(delegate)
    }
    sendObject(conID: proto.ConID, obj: any) {
        proto.sendObject(conID, obj);
    }
}

class EmptyStrategy extends Strategy {
    constructor() {
        super(null)
    }
    aborted() {}
}

abstract class HostStrategy extends Strategy {
    sessionID: any
    hosting: Map<BigInt, any>                        // conID -> {conID, peerID, protocol}

    constructor(delegate: proto.P2pHandler) {
        super(delegate)
        this.hosting = new Map()
    }
}

abstract class GuestStrategy extends Strategy {
    chatHost: proto.PeerID
    chatConnection: proto.ConID

    constructor(delegate: proto.P2pHandler, chatHost: proto.PeerID) {
        super(delegate)
        this.chatHost = chatHost
    }
    isConnectedToHost() {
        return peerTracker.value == PeerState.connectedToHost
    }
    connectedToHost(conID, protocol, peerID) {
        roleTracker.setValue(RoleState.Guest)
        gui.connectedToHost(peerID)
        this.sendObject(conID, {name: 'user', peer: peer.peerID});
    }
}

class DirectHostStrategy extends HostStrategy {
    constructor(delegate: proto.P2pHandler) {
        super(delegate)
    }
    aborted() {
        ////
    }
    // P2P API
    listening(protocol) {
        if (protocol == textcraftProtocol) {
            this.sessionID = {
                type: 'peerAddr',
                peerID: peer.peerID,
                protocol: textcraftProtocol,
                addrs: peer.peerAddrs
            };

            gui.setConnectString(encodeObject(this.sessionID))
            roleTracker.setValue(RoleState.Host)
            peerTracker.setValue(PeerState.hostingDirectly)
        }
        super.listening(protocol);
    }
    // P2P API
    listenerConnection(conID, peerID, prot) {
        if (prot == textcraftProtocol) {
            var users = []

            console.log("Got connection "+conID+" for protocol "+prot+" from peer "+peerID)
            this.hosting.set(conID, {conID: conID, peerID, protocol: prot})
        }
        super.listenerConnection(conID, peerID, prot)
    }
}

class IndirectHostStrategy extends HostStrategy {
    callbackRelayConID: number

    constructor(delegate: proto.P2pHandler) {
        super(delegate)
    }
    aborted() {
        ////
    }
    abortCallback() {
        proto.stop(callbackProtocol, false)
        proto.close(this.callbackRelayConID)
        this.reset()
    }
    reset() {
        ////
    }
}

class DirectGuestStrategy extends GuestStrategy {
    constructor(delegate: proto.P2pHandler, chatHost: proto.PeerID) {
        super(delegate, chatHost)
    }
    aborted() {
        ////
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
                break;
        }
    }
}

class RelayGuestStrategy extends GuestStrategy {
    constructor(delegate: proto.P2pHandler, chatHost: proto.PeerID) {
        super(delegate, chatHost)
    }
    aborted() {
        ////
    }
}

class CallbackGuestStrategy extends GuestStrategy {
    callbackPeer: string

    constructor(delegate: proto.P2pHandler, chatHost: proto.PeerID) {
        super(delegate, chatHost)
    }
    aborted() {
        ////
    }
    // P2P API
    listenerConnection(conID, peerID, prot) {
        if (prot == callbackProtocol) { // got a callback, verify token later
            if (peerTracker.value != PeerState.awaitingTokenConnection || peerID != this.callbackPeer) {
                proto.connectionError(conID, proto.relayErrors.badCallback, 'Unexpected callback peer', true)
                return
            } else if (this.abort) {
                peer.abortStrategy()
                return
            }
            peerTracker.setValue(PeerState.awaitingToken)
        }
        super.listenerConnection(conID, peerID, prot)
    }
}

class MudCommands extends proto.CommandHandler<Strategy> {
    peer: Peer
    userMap: Map<string, mudcontrol.MudConnection>   // peerID -> user
    sessionID: any
    callbackRelay: string
    abort: boolean
    relayConID: number
    token: string
    mudHost: string

    constructor(peer) {
        super(null, peer.connections, mudCommands, null, [textcraftProtocol]);
        this.userMap = new Map();             // peerID -> user
        this.reset()
    }
    reset() {
        peerTracker.setValue(PeerState.disconnected)
        this.token = null
        this.relayConID = null
        this.userMap = new Map()
        gui.noConnection()
    }
/*
    // P2P API
    peerConnection(conID, peerID, protocol) {
        if (this.delegate instanceof RelayHost && this.delegate.callingBack(conID)) { // patch connection to look like it's incoming
            var info = getConnectionInfo(this.connections, conID);

            info.protocol = this.protocol;
            super.peerConnection(conID, peerID, protocol);
            this.listenerConnection(info.conID, info.peerID, this.protocol); // fake a listener connection
            return;
        }
        super.peerConnection(conID, peerID, protocol);
        switch (peerTracker.value) {
        case PeerState.abortingRelayHosting:
        case PeerState.abortingRelayConnection:
            this.changeState(PeerState.disconnected);
            this.connection = {disconnected: true};
            close(conID);
            break;
        case PeerState.connectingToHost: // connected directly to host
            if (peerID != this.mudHost) {
                alert('Connected to unexpected host: '+peerID);
            } else {
                this.changeState(PeerState.connectedToHost);
                this.connectedToHost(conID, protocol, peerID);
            }
            break;
        case PeerState.connectingToRelayForHosting: // connected to relay
            if (peerID != this.requestedRelayPeer) {
                alert('Connected to unexpected host: ' + peerID + ', expecting relay peer: ' + this.requestedRelayPeer);
            } else {
                proto.sendObject(conID, {
                    name: 'requestHosting',
                    protocol: this.protocol,
                });
                this.sessionID = {
                    peerID: this.connections.peerID,
                    relayID: this.requestedRelayPeer,
                    protocol: this.protocol,
                    addrs: this.relayInfo.addrs,
                };

                this.relayConID = conID;
                //this.relayService = new RelayHost(this, {
                this.delegate = new RelayHost(this.connections, this, {
                    //receiveRelay: this.receiveRelay.bind(this),
                    receiveRelayConnectionFromPeer: this.receiveRelayConnectionFromPeer.bind(this),
                    receiveRelayCallbackRequest: this.receiveRelayCallbackRequest.bind(this),
                    relayConnectionClosed: this.relayConnectionClosed.bind(this),
                }, relayProtocol, this.protocol);
                this.commandConnections.add(conID);
                //this.connections.infoByConID.get(conID).hosted = true;
                this.connection.hosted = true;
                this.hosting.set(conID, {conID: conID, peerID, protocol});
                $('#connectString').value = encodeObject(this.sessionID);
                this.changeState(PeerState.connectedToRelayForHosting);
            }
            break;
        case PeerState.connectingToRelayForConnection: // connected to relay
            if (peerID != this.requestedRelayPeer) {
                alert('Connected to unexpected host: ' + peerID + ', expecting relay peer: ' + this.requestedRelayPeer);
            } else {
                this.delegate = new RelayPeer(this.connections, this, {
                    //receiveRelay: this.receiveRelay.bind(this),
                    //receiveRelayCallbackRequest: this.receiveRelayCallbackRequest.bind(this),
                    receiveRelayConnectionToHost: this.receiveRelayConnectionToHost.bind(this),
                    relayConnectionClosed: this.relayConnectionClosed.bind(this),
                }, relayProtocol);
                proto.sendObject(conID, {
                    name: 'requestRelaying',
                    peerID: this.mudHost,
                    protocol: this.chatProtocol,
                });
                this.relayConID = conID;
            }
            break;
        case PeerState.connectingToRelayForCallback: // connected to relay
            if (peerID != this.callbackRelay) {
                alert('Connected to unexpected host: ' + peerID + ', expecting relay peer: ' + this.callbackRelay);
            } else if (this.abort) {
                this.callbackRelayConID = conID;
                this.abortCallback();
            } else {
                proto.sendObject(conID, {
                    name: 'requestCallback',
                    peerID: this.mudHost,
                    callbackPeer: encodePeerId(this.connections.peerID, this.peerAddrs),
                    protocol: this.chatProtocol,
                    callbackProtocol: callbackProtocol,
                    token: this.token,
                });
                this.callbackRelayConID = conID;
                this.changeState(PeerState.awaitingTokenConnection);
            }
            break;
        case PeerState.hostingDirectly: // got new direct chat connection -- nothing more needed
        case PeerState.disconnected: // these next cases should never happen
        case PeerState.stoppingHosting:
        case PeerState.disconnectingFromHost:
        case PeerState.disconnectingFromRelayForHosting:
        case PeerState.disconnectingFromRelayForConnection:
        case PeerState.connectedToHost:
        case PeerState.connectedToRelayForHosting:
        case PeerState.awaitingToken:
        case PeerState.awaitingTokenConnection:
            break;
        }
    }
    // RELAY API
    receiveRelayConnectionToHost(info, {peerID, protocol}) {
        //// TODO
    }
    // RELAY API
    receiveRelayConnectionFromPeer(info, {peerID, protocol}) {
        //// TODO
    }
    // RELAY API
    //receiveRelayCallbackRequest(info, {peerID, protocol, callbackProtocol, token}) {}
    // RELAY API
    //receiveRelay(info, {peerID, protocol, command}) {}
    // RELAY API
    relayConnectionClosed(info, {peerID, protocol}) {
        //// TODO
    }
*/
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
