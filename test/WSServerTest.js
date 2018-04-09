const WebSocket = require("ws");
const WSServer = require("../WSServer.js");
const msgpack = require("msgpack-lite");

const chai = require("chai");
var expect = chai.expect;

const log = require("loglevel");
log.getLogger("WSServer").setLevel("silent"); //silence log output.

describe("WSServer", function() {

    
    describe("Startup & Shutdown", function() {
        let Server;
        

        
        it("should throw an error if no config file was provided", function() {
            expect(function(){
                Server = new WSServer();
            }).to.throw("path must be a string or Buffer");
        });
        
        it("should throw an error if no port was provided", function() {
            expect(function(){
                Server = new WSServer("./test/serverconfig_noPort.json");
            }).to.throw("port must be provided");
        });
        
        it("should start correctly with good config", function(done) {
            expect(function(){
                Server = new WSServer("./test/serverconfig.json");
                Server.on("listening", function() {
                    done();
                });
            }).to.not.throw();
        });
        it("should shut down when calling close", function(done) {
            Server.close(done);
        });        
        it("should error when port is occupied", function(done) {
            Server = new WSServer("./test/serverconfig.json");
            Server.on("listening", function() {
                let Server2 = new WSServer("./test/serverconfig.json"); 
                //We are done if starting Server2 results in an error;
                Server2.on("error", function() {
                    Server.close(done);                    
                });
            });
        });
        

        it("should activate checkOrigin if a baseAddress was provided", function(done) {
            Server = new WSServer("./test/serverconfig_baseAddress.json");
            Server.on("listening", function() {
                const ws = new WebSocket("ws://localhost:8080", {origin: "localhost"});
                ws.on("open", function() {
                    ws.close();
                    Server.close(done);
                });
                ws.on("error", function(err) {
                    //the connection was rejected, this is expected;
                });
            });
        });
        it("should reject other origins if user origin does not match baseAddress", function(done) {
            Server = new WSServer("./test/serverconfig_baseAddress.json");
            Server.on("listening", function() {
                const ws = new WebSocket("ws://localhost:8080", {origin: "not_localhost"});
                ws.on("error", function() {
                    ws.close();
                    Server.close(done);
                });
                
            });
        });
        
        it("should activate handleProtocols if a commProtocol was provided", function(done) {
            Server = new WSServer("./test/serverconfig_commProtocol.json");
            Server.on("listening", function() {
                const ws = new WebSocket("ws://localhost:8080", "TheProtocol");
                ws.on("open", function() {
                    ws.close();
                    Server.close(done);
                });
                ws.on("error", function(err) {
                    //the connection was rejected, this is expected;
                });
            });
        });
        it("should reject other protocols if a commProtocol was provided", function(done) {
            Server = new WSServer("./test/serverconfig_commProtocol.json");
            Server.on("listening", function() {
                const ws = new WebSocket("ws://localhost:8080", "NotTheProtocol");
                ws.on("error", function() {
                    ws.close();
                    Server.close(done);
                });
                
            });
        });
        
        it("should run cleanUserList on an interval", function(done) {
            Server = new WSServer("./test/serverconfig_cleanupInterval.json");
            let ws;
            Server.on("timeout", function() {
                ws.close();
                Server.close(done);
            });
            Server.on("listening", function() {
                ws = new WebSocket("ws://localhost:8080");
                ws.on("error", function(err) {
                    //The websocket is being closed, which triggers the error callback?
                });
            });
            
        });
        
        after(function(done) {
            Server.close(done);
        });
        
    });
    
    describe("Connecting & Messages", function() {
        let Server;
        const port = 8080; //Port for websocket connection from serverconfig.json
        before(function(done) {
            Server = new WSServer("./test/serverconfig.json");
            Server.on("listening", done);
        });
        
        it("should accept WebSocket Connections", function(done){
            const ws = new WebSocket("ws://localhost:"+port);
            ws.on("open", function() {
                ws.close();
                done();
            });
            ws.on("error", function(err) {
                done(err);
            });
        });
        
        it("should emit an 'connect' event upon client connection", function(done) {
            Server.once("connect", function(id){
                expect(id).to.be.a("string");
                done();
            });
            const ws = new WebSocket("ws://localhost:"+port);
        });
        
        it("should emit an 'disconnect' event upon client connection close", function(done) {
            Server.once("disconnect", function(id){
                expect(id).to.be.a("string");
                done();
            });
            const ws = new WebSocket("ws://localhost:"+port);
            ws.on("open", function() {
                ws.close();
            });
        });
        
        it("should error if a invalid message was received (no msgpack)", function(done) {
            Server.once("error", function(error){
                expect(error).to.be.a("error");
                done();
            });
            const ws = new WebSocket("ws://localhost:"+port);
            ws.on("open", function() {
                ws.send("invalid, no msgpack");
                ws.close();
            });
        });
        it("should error if a invalid message was received (no opcode)", function(done) {
            let data = {payload: "dummy data"};
            Server.once("error", function(error){
                expect(error).to.be.a("error");
                done();
            });
            const ws = new WebSocket("ws://localhost:"+port);
            ws.on("open", function() {
                ws.send(msgpack.encode(data));
                ws.close();
            });
        });
        it("should emit opcode if valid message was received", function(done) {
            let opcode = 0x1234;
            let data = {opcode: opcode, payload: "dummy data"};
            Server.once(opcode, function(id, data){
                expect(id).to.be.a("string");
                expect(data).to.deep.equal(data);
                done();
            });
            const ws = new WebSocket("ws://localhost:"+port);
            ws.on("open", function() {
                ws.send(msgpack.encode(data));
                ws.close();
            });
        });
        
        it("should be able to send messages to single users", function(done) {
            const ws = new WebSocket("ws://localhost:"+port);
            const message = "Test";
            //Send message as soon as client connects
            Server.once("connect", function(id) {
                Server.sendToUser(message, id);
            });
            ws.on("message", function(msg) {
                msg = msgpack.decode(msg);
                expect(msg).to.be.a("string").that.is.equal(message);
                ws.close();
                done();
            });
        });
        
        it("should be able to broadcast messages to all users", function(done) {
            const message = "Test";
            //Send message as soon as 2 clients connect
            let connectedUsers = 0;
            let receivedMessages = 0;
            Server.on("connect", function(id) {
                connectedUsers += 1;
                if(connectedUsers == 2) {
                    Server.broadcast(message);
                    Server.removeAllListeners();
                }
            });
            
            function reportBack(msg) {
                msg = msgpack.decode(msg);
                expect(msg).to.be.a("string").that.is.equal(message);
                receivedMessages += 1;
                if(receivedMessages == 2) {
                    ws1.close();
                    ws2.close();
                    done();
                }
            }
            
            const ws1 = new WebSocket("ws://localhost:"+port);
            ws1.on("message", reportBack);
            const ws2 = new WebSocket("ws://localhost:"+port);
            ws2.on("message", reportBack);
        });

        it("should be able to send messages to a list of users", function(done) {
            const message = "Test";
            //Send message to 2 clients as soon as 3 clients connect
            let connectedUsers = [];
            let receivedMessages = 0;
            Server.on("connect", function(id) {
                connectedUsers.push(id);
                if(connectedUsers.length == 3) {
                    Server.sendToList(message, connectedUsers.slice(0,2));
                    Server.removeAllListeners();
                    //wait until all messages are in, then see how many we got
                    setTimeout(function() { 
                        if(receivedMessages == 2) {
                            done();
                        }
                        if(receivedMessages == 3) {
                            done(new Error);
                        }
                        ws1.close();
                        ws2.close();
                        ws3.close();
                        
                    }, 200);
                }
            });
            
            function reportBack(msg) {
                msg = msgpack.decode(msg);
                expect(msg).to.be.a("string").that.is.equal(message);
                receivedMessages += 1;
            }
            
            const ws1 = new WebSocket("ws://localhost:"+port);
            ws1.on("message", reportBack);
            const ws2 = new WebSocket("ws://localhost:"+port);
            ws2.on("message", reportBack);
            const ws3 = new WebSocket("ws://localhost:"+port);
            ws3.on("message", reportBack);
        });
        
        after(function(done) {
            Server.close(done);
        });
        
    });
});

