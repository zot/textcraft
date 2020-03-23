import libp2p from "./protocol.js"

enum NatState {
    Notstarted,
    Unknown,
    Public,
    Private,
}

enum RoleState {
    Guest,
    Host,
    Relay,
}

enum RelayState {
    Idle,
    PendingHosting,
    Hosting,
}

enum SectionState {
    Connection,
    Mud,
    Profile,
    Storage,
}

enum PeerState {
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

var relaying = false
var enumNameMaps = new Map<any, string[]>()

function enumNames(enumObj) {
    if (!enumNameMaps.has(enumObj)) {
        var names = Object.keys(enumObj).filter(o=> typeof enumObj[o] == 'string').map(o=> enumObj[o])

        enumNameMaps.set(enumObj, names as string[])
        return names
    }
    return enumNameMaps.get(enumObj)
}

/// simplementation of jQuery
type nodespec = string | Node | NodeListOf<Node> | Node[]

function $(sel) {
    return typeof sel == 'string' ? document.querySelector(sel) : sel
}
var $all = document.querySelectorAll.bind(document);
function $find(el: nodespec, sel) {
    var res: Node[]

    if (typeof el == 'string') {
        res = [...$all(el)]
    } else if (el instanceof NodeList) {
        res = [...el]
    } else if (el instanceof Node) {
        res = [el]
    }
    if (res.length == 0) {
        return null;
    } else if (res.length > 1) {
        for (var node of res) {
            if (node instanceof Element) {
                var result = node.querySelector(sel);

                if (result) return result;
            }
        }
    } else {
        return $(el).querySelector(sel);
    }
}
function $findAll(el: nodespec, sel) {
    var res: Node[]

    if (typeof el == 'string') {
        res = $all(el);
    }
    if (el instanceof NodeList) {
        el = [...el];
    }
    if (Array.isArray(el)) {
        var results = [];

        for (var node of el) {
            results.push(...(node as Element).querySelectorAll(sel));
        }
        return results;
    } else {
        return $(el).querySelectorAll(sel);
    }
}

class RadioEnum<E> {
    names: string[]
    enumType: any
    value: E
    idSuffix: string
    constructor(enumObj, idSuffix: string) {
        this.names = enumNames(enumObj)
        this.enumType = enumObj
        this.idSuffix = idSuffix
        for (var name of this.names) {
            console.log('name:', name)
            $('#'+name.toLowerCase()+idSuffix).onclick = evt=> this.clicked(evt.target)
        }
        this.setValue(enumObj[this.names[0]])
    }
    setValue(value: E) {
        this.value = value
        $('#'+this.enumType[value].toLowerCase()+this.idSuffix).checked = true
        this.show()
    }
    findEnum(id: string) {
        id = id.substring(0, id.length - this.idSuffix.length).toLowerCase()
        for (var name of this.names) {
            if (id == name.toLowerCase()) {
                return name
            }
        }
        return ''
    }
    clicked(button: HTMLInputElement) {
        console.log('New state:::', button.id)
        this.value = this.enumType[this.findEnum(button.id)]
        this.show()
    }
    classForEnumName(n: string) {
        return n.toLowerCase() + this.idSuffix
    }
    show() {
        console.log('showing emulation state:', this.enumType[this.value])
        for (var st of this.names) {
            document.body.classList.remove(this.classForEnumName(st))
        }
        document.body.classList.add(this.classForEnumName(this.enumType[this.value]))
    }
}

var natRadio = new RadioEnum<NatState>(NatState, 'Nat')
var peerRadio = new RadioEnum<PeerState>(PeerState, 'Peer')
var roleRadio = new RadioEnum<RoleState>(RoleState, 'Role')
var relayRadio = new RadioEnum<RelayState>(RelayState, 'Relay')
var sectionRadio = new RadioEnum<SectionState>(SectionState, 'Section')

function setUser(name) {
    document.body.classList.add('hasuser')
}

export function start() {
    $('#user').onblur = ()=> setUser($('#user').value)
    $('#user').onkeydown = evt=> {
        if (evt.key == 'Enter') {
            setUser($('#user').value)
        }
    }
    $('#toggleStatebuttons').onclick = ()=> document.body.classList.toggle('emulation')
}
