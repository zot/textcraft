const enumNameMaps = new Map();
export var NatState;
(function (NatState) {
    NatState[NatState["Notstarted"] = 0] = "Notstarted";
    NatState[NatState["Unknown"] = 1] = "Unknown";
    NatState[NatState["Public"] = 2] = "Public";
    NatState[NatState["Private"] = 3] = "Private";
})(NatState || (NatState = {}));
export var RoleState;
(function (RoleState) {
    RoleState[RoleState["None"] = 0] = "None";
    RoleState[RoleState["Guest"] = 1] = "Guest";
    RoleState[RoleState["Host"] = 2] = "Host";
    RoleState[RoleState["Relay"] = 3] = "Relay";
    RoleState[RoleState["Solo"] = 4] = "Solo";
})(RoleState || (RoleState = {}));
export var RelayState;
(function (RelayState) {
    RelayState[RelayState["None"] = 0] = "None";
    RelayState[RelayState["Idle"] = 1] = "Idle";
    RelayState[RelayState["PendingHosting"] = 2] = "PendingHosting";
    RelayState[RelayState["Hosting"] = 3] = "Hosting";
})(RelayState || (RelayState = {}));
export var SectionState;
(function (SectionState) {
    SectionState[SectionState["Connection"] = 0] = "Connection";
    SectionState[SectionState["Mud"] = 1] = "Mud";
    SectionState[SectionState["Profile"] = 2] = "Profile";
    SectionState[SectionState["Storage"] = 3] = "Storage";
    SectionState[SectionState["Info"] = 4] = "Info";
})(SectionState || (SectionState = {}));
export var MudState;
(function (MudState) {
    MudState[MudState["NotPlaying"] = 0] = "NotPlaying";
    MudState[MudState["Playing"] = 1] = "Playing";
})(MudState || (MudState = {}));
export var PeerState;
(function (PeerState) {
    PeerState[PeerState["disconnected"] = 0] = "disconnected";
    PeerState[PeerState["abortingRelayHosting"] = 1] = "abortingRelayHosting";
    PeerState[PeerState["abortingRelayConnection"] = 2] = "abortingRelayConnection";
    PeerState[PeerState["stoppingHosting"] = 3] = "stoppingHosting";
    PeerState[PeerState["startingHosting"] = 4] = "startingHosting";
    PeerState[PeerState["disconnectingFromHost"] = 5] = "disconnectingFromHost";
    PeerState[PeerState["disconnectingFromRelayForHosting"] = 6] = "disconnectingFromRelayForHosting";
    PeerState[PeerState["disconnectingFromRelayForConnection"] = 7] = "disconnectingFromRelayForConnection";
    PeerState[PeerState["connectingToHost"] = 8] = "connectingToHost";
    PeerState[PeerState["connectingToRelayForHosting"] = 9] = "connectingToRelayForHosting";
    PeerState[PeerState["connectingToRelayForConnection"] = 10] = "connectingToRelayForConnection";
    PeerState[PeerState["connectingToRelayForCallback"] = 11] = "connectingToRelayForCallback";
    PeerState[PeerState["awaitingTokenConnection"] = 12] = "awaitingTokenConnection";
    PeerState[PeerState["awaitingToken"] = 13] = "awaitingToken";
    PeerState[PeerState["connectedToHost"] = 14] = "connectedToHost";
    PeerState[PeerState["hostingDirectly"] = 15] = "hostingDirectly";
    PeerState[PeerState["connectedToRelayForHosting"] = 16] = "connectedToRelayForHosting";
    PeerState[PeerState["connectedToRelayForConnection"] = 17] = "connectedToRelayForConnection";
})(PeerState || (PeerState = {}));
export class StateTracker {
    constructor(enumObj) {
        this.names = enumNames(enumObj);
        this.enumType = enumObj;
        this.observers = [];
        this.value = enumObj[this.names[0]];
    }
    setValue(value) {
        this.value = value;
        for (const obs of this.observers) {
            obs(this.value, this);
        }
    }
    setValueNamed(name) {
        this.setValue(this.stateForName(name));
    }
    findEnum(id) {
        id = id.toLowerCase();
        for (const name of this.names) {
            if (id === name.toLowerCase()) {
                return name;
            }
        }
        return '';
    }
    stateForName(name) {
        return this.enumType[this.findEnum(name)];
    }
    nameForState(state) {
        return this.enumType[state];
    }
    currentStateName() {
        return this.nameForState(this.value);
    }
    observe(obs) {
        this.observers.push(obs);
        obs(this.value, this);
    }
}
function enumNames(enumObj) {
    if (!enumNameMaps.has(enumObj)) {
        const names = Object.keys(enumObj).filter(o => typeof enumObj[o] === 'string').map(o => enumObj[o]);
        enumNameMaps.set(enumObj, names);
        return names;
    }
    return enumNameMaps.get(enumObj);
}
export function assertUnreachable(s) {
    throw new Error("Shouldn't ever get here");
}
export let natTracker = new StateTracker(NatState);
export let peerTracker = new StateTracker(PeerState);
export let roleTracker = new StateTracker(RoleState);
export let relayTracker = new StateTracker(RelayState);
export let sectionTracker = new StateTracker(SectionState);
export let mudTracker = new StateTracker(MudState);
//# sourceMappingURL=base.js.map