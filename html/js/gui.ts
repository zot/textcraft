import libp2p from "./protocol.js"
import {
    NatState, RoleState, RelayState, SectionState, PeerState,
    StateTracker, stateObserver,
    natTracker, peerTracker, roleTracker, relayTracker, sectionTracker,
} from "./base.js"

var relaying = false

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

class RadioEnum {
    tracker: StateTracker<any>
    idSuffix: string
    constructor(tracker: StateTracker<any>, idSuffix: string) {
        this.tracker = tracker
        this.idSuffix = idSuffix
        for (var name of this.tracker.names) {
            $('#'+name.toLowerCase()+this.idSuffix).onclick = evt=> this.clicked(evt.target)
        }
        tracker.observe(state=>{
            $('#'+this.tracker.currentStateName().toLowerCase()+this.idSuffix).checked = true
            this.show()
        })
        this.show()
    }
    enumForId(id: string) {
        return this.tracker.stateForName(id.substring(0, id.length - this.idSuffix.length))
    }
    clicked(button: HTMLInputElement) {
        console.log('New state:::', button.id)
        this.tracker.setValue(this.enumForId(button.id))
    }
    classForEnumName(n: string) {
        return n.toLowerCase() + this.idSuffix
    }
    show() {
        console.log('showing emulation state:', this.tracker.currentStateName())
        for (var st of this.tracker.names) {
            document.body.classList.remove(this.classForEnumName(st))
        }
        document.body.classList.add(this.classForEnumName(this.tracker.currentStateName()))
    }
}

function radioTracker(tracker: StateTracker<any>, idSuffix: string) {
    new RadioEnum(tracker, idSuffix)
}

function setUser(name) {
    document.body.classList.add('hasuser')
}

export function start() {
    radioTracker(natTracker, 'Nat')
    radioTracker(peerTracker, 'Peer')
    radioTracker(roleTracker, 'Role')
    radioTracker(relayTracker, 'Relay')
    radioTracker(sectionTracker, 'Section')
    $('#user').onblur = ()=> setUser($('#user').value)
    $('#user').onkeydown = evt=> {
        if (evt.key == 'Enter') {
            setUser($('#user').value)
        }
    }
    $('#toggleStatebuttons').onclick = ()=> document.body.classList.toggle('emulation')
}
