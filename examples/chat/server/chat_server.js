const WSServer = require("../../../WSServer.js");

const Opcodes = {
    CMSG_NEW_USER: 1,
    SMSG_USER_LIST: 2,
    MSG_CHATMESSAGE: 3
}

const server = new WSServer("./serverconfig.json");

var online_users = {};

// A new user comes online - update everyones userlist
server.on(Opcodes.CMSG_NEW_USER, function(id, msg) {
    online_users[id] = msg.name;
    
    let userlist = Object.values(online_users);
    
    server.broadcast({opcode: Opcodes.SMSG_USER_LIST, list: userlist});
});

// A user sends a message - broadcast it to the world
server.on(Opcodes.MSG_CHATMESSAGE, function(id, msg) {
    let username = online_users[id];
    
    server.broadcast({opcode: Opcodes.MSG_CHATMESSAGE, name: username, message: msg.message});
});

//A user disconnects - update everyones userlist again
server.on("disconnect", function(id) {
    delete online_users[id];
    
    let userlist = Object.values(online_users);
    
    server.broadcast({opcode: Opcodes.SMSG_USER_LIST, list: userlist});
});
