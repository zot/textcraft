# extensions -- allow people to hack Textcraft without needing a new exe
* peer extensions run automatically but can be disabled with a URL parameter (added via -safe arg)
* mud extensions (stored in each mud and not activated until mud is run)
# admins should see obj ids
# use JSON for commands (or encode it) so we can put exits in the GUI
# object editor
# users panel should show download requests, allow admin up/downgrades
# Commands
* say ' "
* act :
* locks, keys, fail messages
* locked commands need a key
* get (get from direction)
* drop

# Sign messages so relaying is safe
* (peer docs)[https://godoc.org/github.com/libp2p/go-libp2p-core/peer]
  * key -> peer ID
* (crypto docs)[https://godoc.org/github.com/libp2p/go-libp2p-core/crypto]
  * signing/verifying data

# GUI Tweaks
* convert camelCase css classes to dash-names
