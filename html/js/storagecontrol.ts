import * as model from './model.js'

let app: any
let gui: any

export function init(appObj) {
    app = appObj
    gui = app.Gui
}

export async function addMud() {
    const world = await model.storage.openWorld()

    gui.showMuds()
    gui.editWorld(world)
}
