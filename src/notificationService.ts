import cors from "cors";
import express from "express";
import { ApolloServer , gql } from "apollo-server-express";
import jwt from "jsonwebtoken";
import { DateTimeResolver , JSONResolver } from "graphql-scalars";
import * as dotenv from 'dotenv'
import * as bcrypt from "bcrypt";
import GraphQLUpload from 'graphql-upload/GraphQLUpload.js';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.js';
import { checkAuth , fetchRole , fetchId} from "./authorizer.ts";
import {PrismaClient } from "@prisma/client";
import {Kafka , Partitioners , logLevel} from "kafkajs";
import * as postmark from "postmark";
import { create } from "domain";
import { DateTime } from "graphql-scalars/typings/mocks";

(async function () { 

    dotenv.config();
    const prisma = new PrismaClient();

    let notifications = [];

    const emailClient = new postmark.ServerClient(process.env.POSTMARK_TOKEN);


    const kafka = new Kafka({
        clientId: "NotificationService",
        brokers: [process.env.KAFKA_URL],
    });

    const producer = kafka.producer({
        createPartitioner: Partitioners.LegacyPartitioner
    });

    const consumer = kafka.consumer({ groupId: "NotificationService"});

    
    await consumer.connect();
    await consumer.subscribe({ topics: ["notificationRequests" , "user-details"]});

    await consumer.run({
        eachMessage: async ({ topic, partition, message, heartbeat, pause }) => {
            if(topic === "notificationRequests")
            {
                const notification = JSON.parse(message.value.toString());
                await sendEmail(notification.subject , notification.message , Number(notification.userId));
            }
            else if(topic === "user-details")
            {
                console.log("message value is: " + message.value);
                const userDetails = await JSON.parse(message.value.toString());
                const userEmails = await prisma.userEmails.create({
                    data: {
                        userId: Number(userDetails.id),
                        email: userDetails.email
                    }
                    
                })
            }
        },
    });

    // producer.logger().setLogLevel(logLevel.DEBUG);

    const createNotification = async (subject : string , message : string , receiverId : number) => {
        const notification = await prisma.notification.create({
            data : {
                subject : subject,
                message : message,
                receiverId : receiverId
            }
        });

        return notification;
    }

    const sendEmail = async (subject : string , message : string , receiverId : number) => {
        console.log("Entered send email function");
        const userEmails = await prisma.userEmails.findUnique({
            where: {
                userId : receiverId
            }
        });
        console.log("Receiver ID is: " + receiverId);
        console.log("User found is: " + userEmails);
        const response = await emailClient.sendEmail({
            From: "abdulrahman.nasr@student.giu-uni.de",
            To: userEmails.email,
            Subject: subject,
            HtmlBody: message,
            TextBody: message,
            MessageStream: "outbound"
        });

        createNotification(subject , message , receiverId);

        return response;
    }

    const typeDefs = gql`
        scalar DateTime
        scalar Json

        type Notification {
            id: Int!
            subject: String!
            message: String!
            receiverId: Int!
            opened: Boolean!
            createdAt: DateTime!
        }

        type Query {
            fetchMyNotifications: [Notification]
            fetchAllNotifications: [Notification]
            
        }

        type Mutation {
            createNotification(type : String! , to : String! , data : Json!): Notification
            setNotificationAsRead(id : Int!): Notification
            setNoficationsAsRead(ids : [Int]!): [Notification]
        }

    `;

    const resolvers = {
        DateTime: DateTimeResolver,
        JSON: JSONResolver,
        Query: {
            fetchMyNotifications: async(_ , __ , {req , res} : any) => {
                if(checkAuth(["admin" , "driver" , "student"] , fetchRole(req.headers.cookie)))
                {
                    const userId = fetchId(req.headers.cookie);
                    const notifications = await prisma.notification.findMany({
                        where: {
                            receiverId: userId
                        }
                    });
                    console.log("Returning: " , JSON.stringify(notifications));
                    return notifications;
                }
                else
                {
                    throw new Error("Unauthorized");
                }
            },
            fetchAllNotifications: async(_parent : any , args : any , {req , res} : any) => {
                if(checkAuth(["admin"] , fetchRole(req.headers.cookie)))
                {
                    const notifications = await prisma.notification.findMany();
                    return notifications;
                }
                else
                {
                    throw new Error("Unauthorized");
                }
            }
        },
        Mutation: {
            createNotification: async(_parent : any , args : any , {req , res} : any) => {
                if(checkAuth(["admin"] , fetchRole(req.headers.cookie)))
                {
                    const notification = await createNotification(args.type , args.message , args.to);
                    return notification;
                }
                else
                {
                    throw new Error("Unauthorized");
                }
            },
            setNotificationAsRead: async(_parent : any , args : any , {req , res} : any) => {
                if(checkAuth(["admin" , "driver" , "student"] , fetchRole(req.headers.cookie)))
                {
                    const notification = await prisma.notification.update({
                        where: {
                            id: args.id
                        },
                        data: {
                            opened: true
                        }
                    });
                    return notification;
                }
                else
                {
                    throw new Error("Unauthorized");
                }
            },
            setNoficationsAsRead: async(_parent : any , args : any , {req , res} : any) => {
                if(checkAuth(["admin" , "driver" , "student"] , fetchRole(req.headers.cookie)))
                {
                    const notifications = await prisma.notification.updateMany({
                        where: {
                            id: {
                                in: args.ids
                            }
                        },
                        data: {
                            opened: true
                        }
                    });
                    return notifications;
                }
                else
                {
                    throw new Error("Unauthorized");
                }
            }
        }
    }

    const app = express() as any;
    var corsOptions = {
        origin : ["https://giu-pooling-frontend-production.up.railway.app" , "https://giu-pooling-frontend-production.up.railway.app/"],
        credentials: true
    }
    app.use(cors(corsOptions));

    const server = new ApolloServer({
        typeDefs, 
        resolvers,
        context: async ({req, res}) => ({
            req , res
        }),

    })

    await server.start();
    console.log("Server started");
    await server.applyMiddleware({app , path : "/notification" , cors: false});
    console.log("Middleware Applied!");

    app.listen({port : 4005} , () => {
        console.log("Server is ready at http://localhost:4005" + server.graphqlPath);

    })


})();
