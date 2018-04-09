const events = require('events');
const util = require('util');
const Options = require("options");
const uuid = require("uuid/v4");
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const msgpack = require("msgpack-lite");
const log = require("loglevel").getLogger("WSServer");
require('tinycolor');


function WSServer(configFile) {
    events.EventEmitter.call(this);

    var self = this;
    var cleanupInterval;


    var config = new Options({
        baseAdress: null,
        port: null,
        activitySpan: 600, /*sec - 10 minutes until inactive*/
        logoutSpan: 3600, /*sec - 60 minutes until logout*/
        cleanupInterval: 60, /*sec - clean once per minute*/
        commProtocol: null
    }).read(configFile);

    if (!config.isDefinedAndNonNull('port')) {
        throw new TypeError('port must be provided');
    }


    var wss = new WebSocketServer({
        port: config.value.port,
        verifyClient: config.isDefinedAndNonNull('baseAdress') ? checkOrigin : null,
        handleProtocols: config.isDefinedAndNonNull('commProtocol') ? handleProtocols : null
    });

    var userlist = {};
    //Forward listening and error events
    wss.on('listening', function() {
        self.emit("listening");
        log.info("Server Listening");
    })
    wss.on('error', function(err) {
        log.error("Startup error");
        log.debug(err);
        self.emit("error", err);
        Close();
    })

    wss.on('connection', function(ws) {
        ws.on("error", function(err) {
            if(err.code == "ECONNRESET") {
                console.log("Connection reset");
                ws.close();
            } else {
                log.error("Socket error")
                log.debug(err);
            }
        });
        ws.id = uuid();

        userlist[ws.id] = {socket: ws, lastMessageTimestamp: Date.now()};
        self.emit("connect", ws.id);

        ws.on('message', function(data, flags) {
            var clientMsg;
            try {
                clientMsg = msgpack.decode(data);
                log.info(String(ws.id).cyan, " => ", clientMsg);

            } catch (e) {
                log.error(String(e).red);
                self.emit("error", e);
                return;
            }
            if (!("opcode" in clientMsg)) {
                log.error(String(ws.id).red, " => invalid message: "+JSON.stringify(clientMsg));
                self.emit("error", new Error("No Opcode received: " + JSON.stringify(clientMsg)));
                return;
            }
            userlist[ws.id].lastMessageTimestamp = Date.now();

            self.emit(clientMsg.opcode, ws.id, clientMsg);
        });

        ws.on("close", function() {
            log.info("disconnecting");
            self.emit("disconnect", ws.id);
            delete userlist[ws.id];
        });
    });

    function Broadcast(data) {
        data = msgpack.encode(data);
        wss.clients.forEach(function(client){
            if(client.readyState == WebSocket.OPEN) {
                client.send(data);
            }
        });
    };

    function SendToList(data, list) {
        if(!Array.isArray(list)) {
            return;
        }
        data = msgpack.encode(data);

        var n = list.length;
        var id;
        for(var i = 0; i < n; i += 1) {
            id = list[i];
            if (id in userlist && userlist[id].socket.readyState == WebSocket.OPEN) {
                userlist[id].socket.send(data);
            }
        }
    };
    function SendToUser(data, id) {
        data = msgpack.encode(data);

        if (id in userlist && userlist[id].socket.readyState == WebSocket.OPEN) {
            userlist[id].socket.send(data);
        }
    }


    /**
     * private function checkOrigin
     *
     * Verify that the connection comes from the place we expect it from
     */
    function checkOrigin(info) {
        if(info.origin == config.value.baseAdress) {
            return true;
        }
        return false;
    }

    /**
     * private function handleProtocols
     *
     * Verify that the client supports the communications protocol we want
     */
    function handleProtocols(protocols, request) {
        if(protocols.indexOf(config.value.commProtocol) !== -1) {
            return config.value.commProtocol;
        } else {
            return false;
        }
    }

    function cleanUserList() {
        var time = Date.now();
        var id, i;
        var users = [];

        for(id in userlist) {
            if(userlist[id].lastMessageTimestamp < time - (config.value.logoutSpan * 1000) ) {
                userlist[id].socket.close(1000, "Session timed out");
                log.info( ("User %s is being logged out.").yellow, id);
                self.emit("timeout", id);
                users.push(id);
            }
        }

        if(users.length > 0) {
            for(i = 0; i < users.length; i += 1) {
                delete userlist[users[i]];
            }

        }
    };

    cleanupInterval = setInterval(cleanUserList, config.value.cleanupInterval*1000); //Run cleanup of users which have been inactive for config.cleanupInterval
    
    function Close(callback) {
        var id;
        for(id in userlist) {
            userlist[id].socket.close(1000, "Server shutting down");
        }
        clearInterval(cleanupInterval);
        wss.close(callback);
    }

    //expose some internals
    this.sendToUser = SendToUser;
    this.sendToList = SendToList;
    this.broadcast = Broadcast;     //not sure we need this one, can be emulated by sendToList
    this.close = Close;         //kill the server;

}

util.inherits(WSServer, events.EventEmitter);

module.exports = WSServer;
