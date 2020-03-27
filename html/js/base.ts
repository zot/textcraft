var enumNameMaps = new Map<any, string[]>()

export enum NatState {
    Notstarted,
    Unknown,
    Public,
    Private,
}

export enum RoleState {
    Guest,
    Host,
    Relay,
}

export enum RelayState {
    Idle,
    PendingHosting,
    Hosting,
}

export enum SectionState {
    Connection,
    Mud,
    Profile,
    Storage,
}

export enum PeerState {
    disconnected,
    abortingRelayHosting,
    abortingRelayConnection,
    stoppingHosting,
    disconnectingFromHost,
    disconnectingFromRelayForHosting,
    disconnectingFromRelayForConnection,
    connectingToHost,
    connectingToRelayForHosting,
    connectingToRelayForConnection,
    connectingToRelayForCallback,
    awaitingTokenConnection,
    awaitingToken,
    connectedToHost,
    hostingDirectly,
    connectedToRelayForHosting,
    connectedToRelayForConnection,
}

export type stateObserver<E> = (state: E, tracker: StateTracker<E>) => void

export class StateTracker<E> {
    names: string[]
    enumType: any
    value: E
    observers: stateObserver<E>[]
    constructor(enumObj) {
        this.names = enumNames(enumObj)
        this.enumType = enumObj
        this.observers = []
        this.value = enumObj[this.names[0]]
    }
    setValue(value: E) {
        this.value = value
        for (let obs of this.observers) {
            obs(this.value, this)
        }
    }
    setValueNamed(name: string) {
        this.setValue(this.stateForName(name))
    }
    findEnum(id: string): string {
        id = id.toLowerCase()
        for (var name of this.names) {
            if (id == name.toLowerCase()) {
                return name
            }
        }
        return ''
    }
    stateForName(name: string): E {
        return this.enumType[this.findEnum(name)]
    }
    nameForState(state: E): string {
        return this.enumType[state]
    }
    currentStateName(): string {
        return this.nameForState(this.value)
    }
    observe(obs: stateObserver<E>) {
        this.observers.push(obs)
        obs(this.value, this)
    }
}

function enumNames(enumObj) {
    if (!enumNameMaps.has(enumObj)) {
        var names = Object.keys(enumObj).filter(o=> typeof enumObj[o] == 'string').map(o=> enumObj[o])

        enumNameMaps.set(enumObj, names as string[])
        return names
    }
    return enumNameMaps.get(enumObj)
}

export var natTracker = new StateTracker<NatState>(NatState)
export var peerTracker = new StateTracker<PeerState>(PeerState)
export var roleTracker = new StateTracker<RoleState>(RoleState)
export var relayTracker = new StateTracker<RelayState>(RelayState)
export var sectionTracker = new StateTracker<SectionState>(SectionState)
