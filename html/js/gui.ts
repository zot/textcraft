import libp2p from "./protocol.js"
import {
    NatState, RoleState, RelayState, SectionState, PeerState,
    StateTracker, stateObserver,
    natTracker, peerTracker, roleTracker, relayTracker, sectionTracker,
} from "./base.js"
import * as model from './model.js'
import * as mudcontrol from './mudcontrol.js'
import * as storagecontrol from './storagecontrol.js'

var relaying = false
var nextId = 0

export function init(appObj) {}

/// simplementation of jQuery
type nodespec = string | Node | NodeListOf<Node> | Node[]

function $(sel) {
    return typeof sel == 'string' ? document.querySelector(sel) : sel
}
function $all(sel) {
    return [...document.querySelectorAll(sel)]
}
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

class RadioTracker {
    tracker: StateTracker<any>
    idSuffix: string
    constructor(tracker: StateTracker<any>, idSuffix: string) {
        this.tracker = tracker
        this.idSuffix = idSuffix
        for (let name of this.tracker.names) {
            for (let node of $all('#'+name.toLowerCase()+this.idSuffix)) {
                node.onclick = evt=> this.clicked(evt.target)
            }
        }
        tracker.observe(state=>{
            for (let node of $all('#'+this.tracker.currentStateName().toLowerCase()+this.idSuffix)) {
                node.checked = true
            }
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
    new RadioTracker(tracker, idSuffix)
}

function setUser(name) {
    document.body.classList.add('hasuser')
}

function cloneTemplate(name) {
    var t = $(name)

    if (t) {
        var node = t.cloneNode(true)

        node.id = null
        for (let n of $findAll(node, '*')) {
            if (!n.id) {
                n.id = `id-${nextId++}`
            }
        }
        for (let n of $findAll(node, 'label')) {
            var name = n.getAttribute('for')

            if (name) {
                var target = $find(node, `[name=${name}]`)

                if (target) {
                    n.setAttribute('for', target.id)
                }
            }
        }
        return node
    }
}

export function showMuds() {
    $('#storage-list').innerHTML = ''
    for (let world of model.storage.worlds) {
        let div = cloneTemplate('#mud-item-template')

        $('#storage-list').append(div)
        $find(div, '[name=name]').textContent = world
        div.onclick = async ()=> editWorld(await model.storage.openWorld(world))
        $find(div, '[name=delete-mud]').onclick = async evt=> {
            evt.stopPropagation()
            await model.storage.deleteWorld(world)
            showMuds()
        }
        $find(div, '[name=activate-mud]').onclick = async evt=> {
            evt.stopPropagation()
            $('#mud-output').innerHTML = ''
            sectionTracker.setValue(SectionState.Mud)
            mudcontrol.runMud(await model.storage.openWorld(world))
        }
    }
}

export function onEnter(input, action, shouldClear = false) {
    input.onkeydown = evt=> {
        if (evt.key == 'Enter') {
            action(input.value)
            if (shouldClear) {
                input.value = ''
            }
        }
    };
}

export async function editWorld(world: model.World) {
    let redoUsers = [false]
    let div = cloneTemplate('#mud-editor-template')
    let nameField = $find(div, '[name="mud-name"]')
    let userList = $find(div, '[name=mud-user-list]')
    let success = async ()=> {
        var name = nameField.value

        if (name != world.name) {
            await model.storage.renameWorld(world.name, name)
            showMuds()
        }
        if (blobToRevoke) {
            URL.revokeObjectURL(blobToRevoke)
        }
    }
    let blobToRevoke

    for (let user of await world.getAllUsers()) {
        let div = userItem(user, redoUsers)

        userList.appendChild(div)
    }
    $find(div, '[name=mud-add-user]').onclick = async evt=> {
        console.log('burp')
        evt.stopPropagation()
        let randomName = await world.randomUserName()
        let password = model.randomName('password')
        let user = {name: randomName, password}
        let userDiv = userItem(user, redoUsers)
        userList.appendChild(userDiv, user)
        redoUsers[0] = true
    }
    nameField.value = world.name
    onEnter(nameField, newName=> {
        div.remove()
        success()
    })
    $find(div, '[name=download-mud]').onclick = async evt=> {
        evt.stopPropagation()
        var link = $find(div, '[name=download-mud-link]')
        link.textContent = "Preparing download..."
        var blob = await model.storage.fullBlobForWorld(world.name)
        blobToRevoke = link.href = URL.createObjectURL(blob)
        link.setAttribute('download', world.name+'.json')
        link.textContent = 'Click to download '+world.name+'.json'
    }
    try {
        await okCancel(div, '[name=save]', '[name=cancel]', '[name=mud-name]')
        if (!redoUsers[0]) {
            for (let div of userList.children) {
                let nameField = $find(div, '[name=mud-user-name]')
                let passwordField = $find(div, '[name=mud-user-password]')
                let adminCheckbox = $find(div, '[name=mud-user-admin]')

                if (div.originalUser.name != nameField.value
                    || div.originalUser.password != passwordField.value
                    || div.originalUser.admin != adminCheckbox.checked) {
                    redoUsers[0] = true
                    break
                }
            }
        }
        if (redoUsers[0]) {
            let newUsers = []

            for (let div of userList.children) {
                var user = div.originalUser

                user.name = $find(div, '[name=mud-user-name]').value
                user.password = $find(div, '[name=mud-user-password]').value
                user.admin = $find(div, '[name=mud-user-admin]').checked
                newUsers.push(user)
            }
            await world.replaceUsers(newUsers)
        }
        success()
    } catch(err) {
        if (blobToRevoke) {
            URL.revokeObjectURL(blobToRevoke)
        }
    }
}

function userItem(user: any, redoUsers) {
    let {name, password, admin} = user
    let div = cloneTemplate('#mud-user-item')
    let nameField = $find(div, '[name=mud-user-name]')
    let passwordField = $find(div, '[name=mud-user-password]')
    let adminCheckbox = $find(div, '[name=mud-user-admin]')

    div.originalUser = user
    nameField.value = name
    passwordField.value = password
    adminCheckbox.checked = !!admin
    $find(div, '[name=delete-user]').onclick = async evt=> {
        evt.stopPropagation()
        div.remove()
        redoUsers[0] = true
    }
    return div
}

export function okCancel(div, okSel, cancelSel, focusSel) {
    document.body.appendChild(div)
    focusSel && setTimeout(()=>{
        console.log('focusing ', focusSel, $find(div, focusSel))
        $find(div, focusSel)?.select()
        $find(div, focusSel)?.focus()
    }, 1)
    return new Promise((succeed, fail)=> {
        $find(div, okSel).onclick = ()=> {
            div.remove()
            succeed()
        }
        $find(div, cancelSel).onclick = ()=> {
            div.remove()
            fail()
        }
    })
}

export function setMudOutput(html) {
    $('#mud-output').innerHTML = html
}

export function addMudOutput(html) {
    parseHtml(html, $('#mud-output'))
    $('#mud-output').scrollTo(0, $('#mud-output').offsetHeight)
}

export function focusMudInput() {
    $('#mud-command').focus()
}

export function parseHtml(html, receivingNode = null) {
    var parser = $('#parsing')

    parser.innerHTML = html
    if (parser.children.length == 1) {
        if (receivingNode) {
            receivingNode.appendChild(parser.firstChild)
        } else {
            receivingNode = parser.firstChild
            receivingNode.remove()
        }
    } else {
        if (!receivingNode) {
            receivingNode = document.createElement('div')
        }
        while (parser.firstChild) {
            receivingNode.appendChild(parser.firstChild)
        }
    }
    return receivingNode
}

async function uploadMud(evt) {
    var files = evt.target.files

    if (files.length) {
        for (let file of files) {
            await model.storage.uploadWorld(JSON.parse(await file.text()))
        }
        $('#upload-mud').value = null
        showMuds()
    }
}

export function start() {
    radioTracker(natTracker, 'Nat')
    radioTracker(peerTracker, 'Peer')
    radioTracker(roleTracker, 'Role')
    radioTracker(relayTracker, 'Relay')
    radioTracker(sectionTracker, 'Section')
    sectionTracker.observe(state=> {
        $('#gui-mode').textContent = SectionState[state]
        if (state == SectionState.Mud) {
            $('#mud-command').focus()
        }
    })
    sectionTracker.setValue(SectionState.Storage)
    $('#user').onblur = ()=> setUser($('#user').value)
    $('#user').onkeydown = evt=> {
        if (evt.key == 'Enter') {
            setUser($('#user').value)
        }
    }
    $('#toggleStatebuttons').onclick = ()=> document.body.classList.toggle('emulation')
    $('#add-mud-button').onclick = storagecontrol.addMud
    $('#mud-command').onkeydown = evt=> {
        if (evt.key == 'Enter') {
            mudcontrol.command($('#mud-command').value)
            $('#mud-command').value = ''
        }
    }
    $('#upload-mud').onchange = uploadMud
    showMuds()
}
