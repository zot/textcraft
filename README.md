![Textcraft MUD](html/images/textcraft.png "Textcraft MUD")

# TEXTCRAFT

Textcraft is an oldskool text-based MUD with a twist -- it's peer-to-peer.

There are no servers. YOU own your data.

It relies on [libp2p](https://github.com/libp2p/go-libp2p) for peer-to-peer networking and uses [libp2p-websocket](https://github.com/zot/libp2p-websocket) to connect browsers to libp2p.

# MIT LICENSE

The license is [here](LICENSE)

# More later...

For the moment, there are basic instructions for developing the MUD, below.

# Installing typescript

```shell
npm install -g typescript
```

# Using typescript

Run this in one terminal to compile as you edit

```shell
cd html/js
tsc --target es6 -w *.ts
```

Run this in another terminal to serve up the web page -- we use modules so file:/// won't work :(. This will run the server on port 8888. You can change it with the -port option.

```shell
libp2p-websocket -files html
```
