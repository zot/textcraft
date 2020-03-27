import * as model from './model.js'

var app: any
var gui: any

export function init(appObj) {
    app = appObj
    gui = app.Gui
}

export async function addMud() {
    var world = await model.storage.openWorld()

    gui.showMuds()
    gui.editWorld(world)
}
