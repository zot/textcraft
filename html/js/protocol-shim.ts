import protoLib from './protocol.js'

namespace proto {
    export type PeerID = string
    export type ConID = BigInt

    export declare var relayErrors: any
    export declare var errors: any
    export declare var utfDecoder: TextDecoder
    export declare var utfEncoder: TextEncoder

    export declare function connect(peerID: string, protocol: string, frames: boolean)
    export declare function listen(protocol: string, frames: boolean)
    export declare function close(conID: ConID, callback?: () => void)
    export declare function stop(protocol: string, retainConnections: boolean)
    export declare function start(port: number, peerKey: string)
    export declare function startProtocol(url: string, handler: P2pHandler)
    export declare function encode_ascii85(str: string): string
    export declare function decode_ascii85(str: string): string
    export declare function connectionError(conID: ConID, code: string, msg: string, isCatastrophic: boolean, extra?: any)
    export declare function sendObject(conID: ConID, object: any, callback?: () => void)

    export declare class ConnectionInfo {
        conID: ConID
        peerID: PeerID
        protocol: string
        incoming: boolean
        outgoing: boolean

        constructor(conID: ConID, peerID: PeerID, protocol: string)
    }
    export interface P2pHandler {
        hello(running: boolean, thisVersion: string, currentVersion: string)
        ident(status, peerID, addresses: string[], peerKey: string, currentVersion: string)
        listenerConnection(conID: ConID, peerID: PeerID, protocol: string)
        connectionClosed(conID, msg)
        data(conID, data, obj)        // obj is optionally a JSON obj
        listenRefused(protocol)
        listenerClosed(protocol)
        peerConnection(conID, peerID, prot)
        peerConnectionRefused(peerID, prot, msg)
        error(msg)
        listening(protocol)
        accessChange(access: string)
    }
    export declare class DelegatingHandler<H extends P2pHandler> implements P2pHandler {
        delegate: H

        constructor(delegate: H)
        hello(running: boolean, thisVersion: string, currentVersion: string)
        ident(status, peerID, addresses, peerKey: string, currentVersion: string)
        listenerConnection(conID: ConID, peerID: PeerID, protocol: string)
        connectionClosed(conID, msg)
        data(conID, data, obj)        // obj is optionally a JSON obj
        listenRefused(protocol)
        listenerClosed(protocol)
        peerConnection(conID, peerID, prot)
        peerConnectionRefused(peerID, prot, msg)
        error(msg)
        listening(protocol)
        accessChange(access: string)
    }
    export declare class TrackingHandler<H extends P2pHandler> extends DelegatingHandler<H> {
        constructor(delegate: H, connections: any)
    }

    export declare class LoggingHandler<H extends P2pHandler> extends DelegatingHandler<H> {
        constructor(delegate: H)
    }
    export declare class CommandHandler<H extends P2pHandler> extends DelegatingHandler<H> {
        connections: any
        commandConnections: Set<ConID>
        protocols: Set<string>

        constructor(delegate: H, connections: any, commands: any, delegateData: boolean, protocols: string[])
    }
    export declare class RelayService<H extends P2pHandler> extends CommandHandler<H> {
        constructor(connections: any, delegate: H, relayReceiver: any, relayProtocol: string)
        enableRelay(peerID: PeerID, protocol: string)
        startRelay()
        stopRelay()
        enableHost(peerID: PeerID, protocol: string)
    }
    export declare class RelayClient {
        addConnection(peerID: PeerID, protocol: string, incoming: boolean)
    }
    export declare class RelayHost extends RelayClient {
        constructor(connections: any, handler: any, delegate: any, protocol: string, mainProtocol: string)
    }
    export declare function getInfoForPeerAndProtocol(connections, peerID: PeerID, protocol: string): ConnectionInfo
}

Object.assign(proto, protoLib) // patch library into typescript namespace, proto

export default proto

