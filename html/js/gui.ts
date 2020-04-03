import libp2p from "./protocol.js"
import {
    NatState, RoleState, RelayState, SectionState, PeerState, MudState,
    StateTracker, stateObserver,
    natTracker, peerTracker, roleTracker, relayTracker, sectionTracker, mudTracker,
} from "./base.js"
import * as model from './model.js'
import * as mudcontrol from './mudcontrol.js'
import * as storagecontrol from './storagecontrol.js'
import * as mudproto from './mudproto.js'

const jsyaml: any = (window as any).jsyaml

let nextId = 0

export function init(appObj) {}

/// simplementation of jQuery
type nodespec = string | Node | NodeListOf<Node> | Node[]

function $(sel) {
    return typeof sel === 'string' ? document.querySelector(sel) : sel
}
function $all(sel) {
    return [...document.querySelectorAll(sel)]
}
function $find(el: nodespec, sel) {
    let res: Node[]

    if (typeof el === 'string') {
        res = [...$all(el)]
    } else if (el instanceof NodeList) {
        res = [...el]
    } else if (el instanceof Node) {
        res = [el]
    }
    if (res.length === 0) {
        return null;
    } else if (res.length > 1) {
        for (const node of res) {
            if (node instanceof Element) {
                const result = node.querySelector(sel);

                if (result) return result;
            }
        }
    } else {
        return $(el).querySelector(sel);
    }
}
function $findAll(el: nodespec, sel) {
    let res: Node[]

    if (typeof el === 'string') {
        res = $all(el);
    }
    if (el instanceof NodeList) {
        el = [...el];
    }
    if (Array.isArray(el)) {
        const results = [];

        for (const node of el) {
            results.push(...(node as Element).querySelectorAll(sel))
        }
        return results;
    } else if (el instanceof HTMLElement) {
        return [...$(el).querySelectorAll(sel)]
    } else {
        return []
    }
}

class CssClassTracker {
    tracker: StateTracker<any>
    idSuffix: string
    constructor(tracker: StateTracker<any>, idSuffix: string) {
        this.tracker = tracker
        this.idSuffix = idSuffix
        tracker.observe(state=>{
            for (const node of $all('#'+this.tracker.currentStateName().toLowerCase()+this.idSuffix)) {
                node.checked = true
            }
            this.show()
        })
        this.show()
    }
    classForEnumName(n: string) {
        return n.toLowerCase() + this.idSuffix
    }
    show() {
        console.log('showing emulation state:', this.tracker.currentStateName())
        for (const st of this.tracker.names) {
            document.body.classList.remove(this.classForEnumName(st))
        }
        document.body.classList.add(this.classForEnumName(this.tracker.currentStateName()))
    }
}

class RadioTracker extends CssClassTracker {
    constructor(tracker: StateTracker<any>, idSuffix: string) {
        super(tracker, idSuffix)
        for (const name of this.tracker.names) {
            for (const node of $all('#'+name.toLowerCase()+this.idSuffix)) {
                node.onclick = evt=> this.clicked(evt.target)
                if (!node.name) node.name = idSuffix + '-radio'
            }
        }
        tracker.observe(state=>{
            for (const node of $all('#'+this.tracker.currentStateName().toLowerCase()+this.idSuffix)) {
                node.checked = true
            }
        })
    }
    enumForId(id: string) {
        return this.tracker.stateForName(id.substring(0, id.length - this.idSuffix.length))
    }
    clicked(button: HTMLInputElement) {
        console.log('New state:::', button.id)
        this.tracker.setValue(this.enumForId(button.id))
    }
}

function radioTracker(tracker: StateTracker<any>, idSuffix: string) {
    new RadioTracker(tracker, idSuffix)
}

function setUser(name) {
    document.body.classList.add('hasuser')
}

function cloneTemplate(name) {
    const t = $(name)

    if (t) {
        const node = t.cloneNode(true)

        node.id = null
        for (const n of $findAll(node, '*')) {
            if (!n.id) {
                n.id = `id-${nextId++}`
            }
        }
        for (const n of $findAll(node, 'label')) {
            const radioName = n.getAttribute('for')

            if (radioName) {
                const target = $find(node, `[name=${radioName}]`)

                if (target) {
                    n.setAttribute('for', target.id)
                }
            }
        }
        return node
    }
}

export function showMuds() {
    const worldList = [...model.storage.worlds]

    worldList.sort()
    $('#storage-list').innerHTML = ''
    for (const world of worldList) {
        const div = cloneTemplate('#mud-item-template')

        $('#storage-list').append(div)
        $find(div, '[name=name]').textContent = world
        div.onclick = async ()=> editWorld(await model.storage.openWorld(world))
        $find(div, '[name=copy-mud]').onclick = async evt=> {
            evt.stopPropagation()
            const w = await model.storage.openWorld(world)
            const newName = worldCopyName(world)
            await w.copyWorld(newName)
            showMuds()
            return editWorld(await model.storage.openWorld(newName))
        }
        $find(div, '[name=activate-mud]').onclick = async evt=> {
            evt.stopPropagation()
            if (mudTracker.value === MudState.NotPlaying) {
                $('#mud-output').innerHTML = ''
                sectionTracker.setValue(SectionState.Mud)
                roleTracker.setValue(RoleState.Solo)
                mudcontrol.runMud(await model.storage.openWorld(world), text=> {
                    addMudOutput('<div>'+text+'</div>')
                })
                $('#mud-name').textContent = world
            } else {
                mudcontrol.quit()
            }
        }
        $find(div, '[name=activate-mud]').setAttribute('mud', world)
    }
}

function worldCopyName(oldName: string) {
    const nameTemplate = 'Copy of '+oldName

    if (model.storage.worlds.indexOf(nameTemplate) === -1) {
        return nameTemplate
    }
    let counter = 1

    while (model.storage.worlds.indexOf(nameTemplate + ' ' + counter) !== -1) {
        counter++
    }
    return nameTemplate + ' ' + counter
}

export function onEnter(input, action, shouldClear = false) {
    input.onkeydown = evt=> {
        if (evt.key === 'Enter') {
            action(input.value)
            if (shouldClear) {
                input.value = ''
            }
        }
    };
}

export async function editWorld(world: model.World) {
    let processUsers = false
    let deleted = false
    const div = cloneTemplate('#mud-editor-template')
    const nameField = $find(div, '[name="mud-name"]')
    const userList = $find(div, '[name=mud-user-list]')
    let blobToRevoke = null
    const success = async ()=> {
        const name = nameField.value

        if (blobToRevoke) {
            URL.revokeObjectURL(blobToRevoke)
        }
        if (deleted) {
            console.log("DELETED")
            await model.storage.deleteWorld(world.name)
            showMuds()
            return
        }
        if (name !== world.name) {
            await model.storage.renameWorld(world.name, name)
            showMuds()
        }
        if (!processUsers) {
            for (const childDiv of userList.children) {
                const childNameField = $find(childDiv, '[name=mud-user-name]')
                const passwordField = $find(childDiv, '[name=mud-user-password]')
                const adminCheckbox = $find(childDiv, '[name=mud-user-admin]')

                if (childDiv.originalUser.name !== childNameField.value
                    || childDiv.originalUser.password !== passwordField.value
                    || childDiv.originalUser.admin !== adminCheckbox.checked) {
                    processUsers = true
                    break
                }
            }
        }
        if (processUsers) {
            const newUsers = []

            for (const childDiv of userList.children) {
                const user = childDiv.originalUser

                user.name = $find(childDiv, '[name=mud-user-name]').value
                user.password = $find(childDiv, '[name=mud-user-password]').value
                user.admin = $find(childDiv, '[name=mud-user-admin]').checked
                newUsers.push(user)
            }
            await world.replaceUsers(newUsers)
        }
    }

    for (const user of await world.getAllUsers()) {
        const itemDiv = userItem(user, ()=> processUsers = true)

        userList.appendChild(itemDiv)
    }
    $find(div, '[name=mud-add-user]').onclick = async evt=> {
        console.log('burp')
        evt.stopPropagation()
        const randomName = await world.randomUserName()
        const password = model.randomName('password')
        const user = {name: randomName, password}
        const userDiv = userItem(user, ()=> processUsers = true)
        userList.appendChild(userDiv, user)
        $find(userDiv, '[name=mud-user-name]').select()
        $find(userDiv, '[name=mud-user-name]').focus()
        processUsers = true
    }
    nameField.value = world.name
    onEnter(nameField, newName=> {
        div.remove()
        return success()
    })
    $find(div, '[name=download-mud]').onclick = async evt=> {
        evt.stopPropagation()
        const link = $find(div, '[name=download-mud-link]')
        link.textContent = "Preparing download..."
        const blob = await model.storage.fullBlobForWorld(world.name)
        blobToRevoke = link.href = URL.createObjectURL(blob)
        link.setAttribute('download', world.name+'.yaml')
        link.textContent = 'Click to download '+world.name+'.yaml'
    }
    $find(div, '[name=delete-mud]').onclick = async evt=> {
        evt.stopPropagation()
        deleted = !deleted
        div.classList.toggle('mud-deleted')
    }
    try {
        await okCancel(div, '[name=save]', '[name=cancel]', '[name=mud-name]')
        await success()
    } catch(err) { // revoke URL on cancel
        if (blobToRevoke) {
            URL.revokeObjectURL(blobToRevoke)
        }
    }
}

function userItem(user: any, processUsersFunc) {
    const {name, password, admin} = user
    const div = cloneTemplate('#mud-user-item')
    const nameField = $find(div, '[name=mud-user-name]')
    const passwordField = $find(div, '[name=mud-user-password]')
    const adminCheckbox = $find(div, '[name=mud-user-admin]')

    div.originalUser = user
    nameField.value = name
    passwordField.value = password
    adminCheckbox.checked = !!admin
    $find(div, '[name=delete-user]').onclick = async evt=> {
        evt.stopPropagation()
        div.remove()
        processUsersFunc()
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
    parseHtml(html, $('#mud-output'), (el)=> {
        for (const node of $findAll(el, '.input')) {
            node.onclick = ()=> {
                $('#mud-command').value = $find(node, '.input-text').textContent
                $('#mud-command').select()
                $('#mud-command').focus()
            }
        }
    })
    $('#mud-output').scrollTo(0, $('#mud-output').scrollHeight)
}

export function focusMudInput() {
    $('#mud-command').focus()
}

export function parseHtml(html, receivingNode = null, formatter:(el: HTMLElement)=>void = null) {
    const parser = $('#parsing')

    parser.innerHTML = html
    if (parser.children.length === 1) {
        if (formatter) formatter(parser.firstChild)
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
            if (formatter) formatter(parser.firstChild)
            receivingNode.appendChild(parser.firstChild)
        }
    }
    return receivingNode
}

async function uploadMud(evt) {
    const files = evt.target.files

    if (files.length) {
        for (const file of files) {
            await model.storage.uploadWorld(jsyaml.load(await file.text()))
        }
        $('#upload-mud').value = null
        showMuds()
    }
}

export function setConnectString(cst: string) {
    $('#connectString').value = cst
}

export function setPeerId(id: string) {
    $('#peerID').textContent = id;
}

export function noConnection() {
    $('#connectStatus').textContent = '';
    $('#connectString').value = '';
    $('#connect').disabled = false;
    $('#connect').textContent = 'Connect';
    $('#toHostID').value = '';
    $('#toHostID').disabled = false;
    $('#toHostID').readOnly = false;
    //$('#send').value = '';
    $('#hostingRelay').readOnly = false;
}

export function connectedToHost(peerID: string) {
    $('#connectStatus').textContent = 'Connected to '+ peerID
}

export function connectionRefused(peerID: string, protocol: string, msg) {
    $('#toHostID').value = 'Failed to connect to '+peerID+' on protocol '+protocol
}

export function hosting(protocol: string) {
    $('#host-protocol').value = 'WAITING TO ESTABLISH LISTENER ON '+protocol
}

export function showUsers(userMap: Map<string, mudproto.UserInfo>) {
    const users = [...userMap.values()]

    users.sort((a, b)=> a.name === b.name ? 0 : a.name < b.name ? -1 : 1)
    for (const user of users) {
        const div = cloneTemplate('#mud-connected-user-item')

        div.textContent = user.name
        div.title = user.peerID
        $('#mud-users').appendChild(div)
    }
}

function showPeerState() {
    $('#direct-connect-string').value = ''
    switch (peerTracker.value) {
        case PeerState.hostingDirectly:
            $('#direct-connect-string').value = mudproto.directConnectString()
            break
    }
}

function showMudState() {
    const playing = mudTracker.value === MudState.Playing
    const mudTabButton = $('#mudSection')
    const mudTab = mudTabButton.closest('.tab')

    if (mudTab.classList.contains('disabled') === playing) {
        mudTab.classList.toggle('disabled')
    }
    mudTabButton.disabled = !playing
    if (playing) {
        sectionTracker.setValue(SectionState.Mud)
        $('#mud-command').removeAttribute('disabled')
        $('#mud-command').focus()
        if (roleTracker.value === RoleState.Host || roleTracker.value === RoleState.Solo) {
            $(`button[mud=${mudcontrol.activeWorld.name}]`).textContent = 'Quit'
        }
    } else {
        for (const button of $all(`button[mud]`)) {
            button.textContent = 'Activate'
        }
        $('#mud-output').innerHTML = ''
        sectionTracker.setValue(SectionState.Storage)
        $('#mud-command').value = ''
        $('#mud-command').setAttribute('disabled', true)
    }
}

function showRelayState(state) {
    if (state === RelayState.PendingHosting || state === RelayState.Hosting) {
        $('#relayConnectString').value = mudproto.peer.relaySessionID()
    }
}

export function error(msg: string) {
    alert(`ERROR: ${msg}`)
}

export function start() {
    radioTracker(natTracker, 'Nat')
    radioTracker(peerTracker, 'Peer')
    radioTracker(roleTracker, 'Role')
    radioTracker(relayTracker, 'Relay')
    radioTracker(sectionTracker, 'Section')
    radioTracker(mudTracker, 'Mud')
    sectionTracker.observe(state=> {
        if (state === SectionState.Mud) {
            $('#mud-command').focus()
        }
    })
    sectionTracker.setValue(SectionState.Storage)
    peerTracker.observe(showPeerState)
    mudTracker.observe(showMudState)
    relayTracker.observe(showRelayState)
    $('#user').onblur = ()=> setUser($('#user').value)
    $('#user').onkeydown = evt=> {
        if (evt.key === 'Enter') {
            setUser($('#user').value)
        }
    }
    $('#toggleStatebuttons').onclick = ()=> document.body.classList.toggle('emulation')
    $('#add-mud-button').onclick = ()=> {
        sectionTracker.setValue(SectionState.Storage)
        return storagecontrol.addMud()
    }
    $('#mud-command').onkeydown = async evt=> {
        if (evt.key === 'Enter') {
            await mudcontrol.executeCommand($('#mud-command').value)
            $('#mud-command').value = ''
        }
    }
    $('#upload-mud').onchange = uploadMud
    $('#upload-mud').onclick = ()=> sectionTracker.setValue(SectionState.Storage)
    $('#mud-host').onclick = ()=> {
        mudproto.startHosting()
    }
    $('#mud-quit').onclick = mudcontrol.quit
    $('#mud-users-toggle').onclick = ()=> $('#mud-section').classList.toggle('show-users')
    $('#direct-connect-string').onclick = evt=> {
        setTimeout(()=> {
            evt.target.select()
            evt.target.focus()
        }, 1)
    }
    $('#connect').onclick = evt=> {
        try {
            mudproto.joinSession($('#toHostID').value)
        } catch (err) {
            alert('Problem joining: ' + err.message)
        }
    }
    $('#mud-stop-hosting').onclick = mudproto.reset
    $('#mud-select-relay').onclick = ()=> {
        roleTracker.setValue(RoleState.Relay)
        sectionTracker.setValue(SectionState.Connection)
    }
    $('#mud-select-join').onclick = ()=> {
        roleTracker.setValue(RoleState.Guest)
        sectionTracker.setValue(SectionState.Connection)
    }
    showMuds()
}
