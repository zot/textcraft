# Can't delete a hosed MUD

# Shouldn't be able to connect two browsers

# Use window messaging to update things so multiple tabs work

# QuestItem prototype
* Generator makes only one per person, recording the generator id in a 'personal' prop
* Items are invisible to others
* Generator sets the 'owner' prop to the creator

# store input history in each mud

# @edit PROPERTY -- put an @set command in the input area for the given property

# JSON output to flag errors and whatnot (and for @edit)

# ownership -- only an owner can change settings on an object

# ban peer command

disallow thing's peer from connecting

# lock peers command -- exclude any other peers from connecting

only allow the currently connected peers to connect again

# Make the create button wait until you save to actually create the MUD

# Extensions:
* Make quitting a MUD with an extension offer to reload the page

# Turn on a light when there are unread messages

# @handoff to hand mud service off to another user
* Transfer the mud to the user
* Transmit connect messages to everyone
* User's MUD hosts
* Everyone reconnects

# private messages

# use JSON for commands output (or encode it) so we can put exits in the GUI

# object editor

# users panel should show download requests, allow admin up/downgrades

# Sign messages so relaying is safe
* (peer docs)[https://godoc.org/github.com/libp2p/go-libp2p-core/peer]
  * key -> peer ID
* (crypto docs)[https://godoc.org/github.com/libp2p/go-libp2p-core/crypto]
  * signing/verifying data

# GUI Tweaks
* convert camelCase css classes to dash-names

# Approval for connections from unknown peers

# Contact list -- peers and human-readable names

# Back up of your peer DB

# Encryption for private key -- request passwd to decrypt
