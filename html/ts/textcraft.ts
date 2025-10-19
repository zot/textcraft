import * as Model from './model'
import * as Gui from './gui'
import { current as Mudproto } from './peer'
import * as App from './app'
import * as StorageControl from './storagecontrol'
import * as MudControl from './mudcontrol'

const app = {
  Model,
  Gui,
  Mudproto,
  App,
  StorageControl,
  MudControl,
}

for (const mod of Object.values(app)) {
  ;(mod as any).init(app)
}

async function start() {
  await Model.openStorage()
  await Gui.start()
  return Mudproto.start(Model.storage)
}

;(window as any).textcraft = app

window.onload = start
