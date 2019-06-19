'use strict'
var mongoose = require('mongoose');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware');
const router = express.Router();
var _config;

if (process.env.environment == 'development') {
    _config = require('./_config_development');
} else if (process.env.environment == 'qa') {
    _config = require('./_config_qa');
} else if (process.env.environment == 'demo') {
    _config = require('./_config_demo');
} else if (process.env.environment == 'stage') {
    _config = require('./_config_stage');
} else if (process.env.environment == 'production') {
    _config = require('./_config');
} else
    _config = require('./_config_development');

var path = require('path');
const logger = require('./logger');
var ESAPI = require('node-esapi');
var csrf = require('csurf');
var helmet = require('helmet');
var xssFilter = require('x-xss-protection');
const app = express();

/*** Start: MongoDB connection setup ***/
mongoose.set('useNewUrlParser', true);
mongoose.set('useCreateIndex', true);
mongoose.set('connectTimeoutMS', 0);
mongoose.set('socketTimeoutMS', 10000);
//mongoose.set('poolSize', 10);
let mongoUrl = mongoose.connect(_config.mongoURI.connectionString);
let i = 0;
mongoose.connection.on('connected', () => {
    logger.info('connected to mongoDB');
    i = 0;
});
mongoose.connection.on('error', (err) => {
    if (err && i<2) {
        setTimeout(connectWithRetry, 500);
        i++;
    } else {
        logger.error('******************* Error in database connection: ************************* ' + err);
    }
});
/*** End: MongoDB connection setup ***/

/*** Start: MongoDB connect retry ***/
var connectWithRetry = function () {
    return mongoose.connect(mongoUrl, {
        useNewUrlParser: true,
        useCreateIndex: true,
        connectTimeoutMS: 0
    }, function (err) {
    });
};
/*** End: MongoDB connect retry ***/

var gracefulExit = function() {
    mongoose.connection.close(function () {
        console.log('Mongoose default connection with DB is disconnected through app termination');
        process.exit(0);
    });
}

// If the Node process ends, close the Mongoose connection
process.on('SIGINT', gracefulExit).on('SIGTERM', gracefulExit);

/*** CORS support with OPTIONS ***/
app.use(cors({
    exposedHeaders: ['x-total-count'],
}));
app.use(xssFilter());
app.use(xssFilter({ setOnOldIE: true }));
app.use(xssFilter({ reportUri: '/report-xss-violation' }));
app.use(bodyParser.json({limit: '10mb', extended: true}));
app.use(bodyParser.urlencoded({limit: '10mb', extended: true}));
app.use(awsServerlessExpressMiddleware.eventContext());

var swaggerUi = require('swagger-ui-express'),
    YAML = require('yamljs'),
    swaggerDocument = YAML.load(path.join(__dirname + '/swagger.yaml'));
var options = {
    swaggerOptions: {
        docExpansion: 'none'
    }
};
app.use('/apiSpec', swaggerUi.serve);
app.get('/apiSpec', swaggerUi.setup(swaggerDocument, options));

app.get('/', (req, res) => {
    res.status(400).send("response from get ");
});

app.use(helmet());
app.options('*', cors());
require('./routes/vendor.route.js')(app, router);
require('./routes/location.route.js')(app, router);
require('./routes/document.route.js')(app, router);
require('./routes/dueDiligence.route.js')(app, router);
require('./routes/stateRequirements.route.js')(app, router);
require('./routes/par.route.js')(app, router);
require('./routes/user.route.js')(app, router);
require('./routes/changelogs.route.js')(app, router);
require('./routes/maindashboard.route.js')(app, router);
require('./routes/par_due_diligence.route.js')(app, router);
require('./routes/par_employee.route.js')(app, router);
require('./routes/par_insurance.route.js')(app, router);
require('./routes/par_license.route.js')(app, router);
require('./routes/region.route.js')(app, router);
require('./routes/states.route.js')(app, router);
require('./routes/user_management.route.js')(app, router);

/*** Client ***/
require('./routes/client_vendor.route.js')(app, router);
require('./routes/client_par.route.js')(app, router);

/*** Par Complaints ***/
require('./routes/par_complaints_tasks.route')(app, router);
require('./routes/par_complaints.route')(app, router);
require('./routes/par_complaints_documents.route')(app,router);
require('./routes/par_complaints_region.route')(app, router);

require('./routes/vendor_location_site_inspection.route')(app, router);

/*** Start Contract routes ***/
require('./routes/contracts.route')(app, router);
/*** End Contract routes ***/

/*** catch 404 and forward to error handler ***/
app.use(function (req, res, next) {
    var err = new Error('Not Found');
    err.Status = 404;
    err.Info = "Route Not Found";
    next(err);
});
app.use(csrf());

/*** Error Handler Function(middleware) ***/
app.use(function (err, req, res, next) {
    logger.info("API Endpoint Hit : " + ESAPI.encoder().decodeForHTML(req.protocol) + '://' + ESAPI.encoder().decodeForHTML(req.get('host')) +decodeURI(req.originalUrl));
    // Validation Error for JOI request
    if (err.isBoom) {
        var error = {
            "Status": 400,
            "Info": [{
                "Error": err.data[0].message.replace(/\"/g, '')
            }],
            "message": "Check Request Data"
        };
        logger.error("JOI validation error");
        logger.error("Payload Request : " + JSON.stringify(req.body));
        logger.error(error);
        res.status(400).send(error);
    } else {
        //Handling Error through Status Codes 
        if (err.Status == 400) {
            var errorMessage = {
                "Status": parseInt(err.Status),
                "Info": err.Info
            };
            logger.error("Bad Request Found");
            logger.error("Payload Request: " + JSON.stringify(req.body));
            logger.error(errorMessage);
            res.status(400).json(errorMessage);
        } else if (err.Status == 404) {
            var errorMessage = {
                "Status": parseInt(err.Status),
                "Info": err.Info
            };
            logger.error("Request Not Found");
            logger.error("Payload Request : " + JSON.stringify(req.body));
            logger.error(errorMessage);
            res.status(404).json(errorMessage);
        } else if (err.Status == 401) {
            var errorMessage = {
                "Status": parseInt(err.Status),
                "Info": err.Info
            };
            logger.error("Forbidden Error");
            logger.error("Payload Request : " + JSON.stringify(req.body));
            logger.error(errorMessage);
            res.status(401).json(errorMessage);
        } else if (err.Status == 403) {
            var errorMessage = {
                "Status": parseInt(err.Status),
                "Info": err.Info
            };
            logger.error("Forbidden Error");
            logger.error("Payload Request : " + JSON.stringify(req.body));
            logger.error(errorMessage);
            res.status(200).json(errorMessage);
        } else {
            var errorMessage = {
                "Status": 500,
                "Info": err.Info ? err.Info : err.name,
                "Error": err.Error ? err.Error : err.message
            };
            logger.error("Internal Server Error Found");
            logger.error("Payload Request : " + JSON.stringify(req.body));
            logger.error(errorMessage);
            res.status(500).json(errorMessage);
        }
    }
});

/*** Unhandled Rejection ***/
process.on("unhandledRejection", (reason, p) => {
        logger.error(reason + " ************** Unhandled Rejection at Promise ****************** ");
        logger.error(p);
    })
    .on("uncaughtException", err => {
        logger.error("Uncaught Exception thrown");
        logger.error(err);
        process.exit(1);
    });
/*** Unhandled Rejection End ***/

module.exports = app;