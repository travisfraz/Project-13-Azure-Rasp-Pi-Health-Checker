require('dotenv').config()
const nodemailer = require('nodemailer')
const { google } =  require('googleapis')
const mysql = require('mysql')

var pool  = mysql.createPool({
    connectionLimit: 10,
    host: 'raspberry-pi-mysql.mysql.database.azure.com',
    user: 'travisfraz@raspberry-pi-mysql',
    password: process.env.DATABASE_PASSWORD,
    database: 'raspberrypitestdb'
});

//Setting up nodemailer with Oauth2 credentials, and access tokens
const oauth2Client = new google.auth.OAuth2(process.env.OAUTH_CLIENT_ID, process.env.OAUTH_CLIENT_SECRET, "https://developers.google.com/oauthplayground")
oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });


module.exports = async function (context, req) {
    
    function getData() {
        return new Promise(
            (resolve, reject) => {
            pool.query('SELECT * FROM home_temp_log ORDER BY _id desc limit 1', function(error, results, fields) {
                if (error) reject(error);
                resolve(results);
            })
        }
        );
    }

    //Checks if the latest recorded temperature's timestamp is within the an acceptable timeframe. Returns obj indicating if a failure email should be sent.
    function healthCheck(results) {
        const timeStamp = results[0].timestamp
        const milTimeStamp = Date.parse(timeStamp)
        const currentTime = new Date().getTime()
        const timeDif = (currentTime - milTimeStamp)/60000  //finds time dif and also converts to min
        const returnObj = {
            sendEmail: false,
            msg: ''
        }
        
        if (timeDif >= 6 && timeDif < 11) {
            returnObj.msg = `Raspberry Pi has stopped saving data to the database. Last saved entry was: ${timeStamp}`
            returnObj.sendEmail = true
        } else if (timeDif < 6) {
            returnObj.msg = 'Raspberry Pi temp sensor working'
        } else if (timeDif >= 11) {
            returnObj.msg = 'Error msg already sent'
        } else {
            returnObj.msg = 'Unhandeled Error'
        }
        return returnObj
    }

    //Send email with the error message
    async function sendEmail(errorMsg) {
        try {
            const accessToken = await oauth2Client.getAccessToken()
            const smtpTransport = nodemailer.createTransport({
                service: "gmail",
                auth: {
                    type: "OAuth2",
                    user: "travisdevelopertest@gmail.com", 
                    clientId: process.env.OAUTH_CLIENT_ID,
                    clientSecret: process.env.OAUTH_CLIENT_SECRET,
                    refreshToken: process.env.OAUTH_REFRESH_TOKEN,
                    accessToken: accessToken
                },
                tls: {
                    rejectUnauthorized: false
                }
            });

            const htmlMsg = `<h2>${errorMsg}</h2>`;

            const mailOptions = {
                from: "travisdevelopertest@gmail.com",
                to: "travisfraz@gmail.com",
                subject: `RaspberryPi Health Checker: Issue Alert`,
                generateTextFromHTML: true,
                html: htmlMsg
            };
        
            const emailResponse = await smtpTransport.sendMail(mailOptions)
            return emailResponse
        } catch(err) {
            console.log(`Error in emailer, @ customOrderCreatedEmail(): ${err}`)
            throw err
        }
    }

    try {
        context.log('JavaScript HTTP trigger function processed a request.');
        const lastMeasurement = await getData()
        const healthChkObj = healthCheck(lastMeasurement)
        if (healthChkObj.sendEmail) {
            const emailResponse = await sendEmail(healthChkObj.msg)
            console.log(emailResponse)
        }
        console.log(healthChkObj)
        context.res = {
            // status: 200, /* Defaults to 200 */
            body: healthChkObj
        };
    } catch(err) {
        console.log(err)
        context.res = {
            status: 500,
            body: err
        };
    }
}