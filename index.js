const express = require('express');
const cors = require('cors');
const app = express()
const port = process.env.PORT || 3000
require('dotenv').config()
const crypto = require('crypto');

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = require("./zap-shift-server-1.json");



//const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
//const serviceAccount = JSON.parse(decoded);

initializeApp({
  credential: cert(serviceAccount)
});

function generateTrackingId() {

  const prefix = "PRCL";

  const randomId = crypto
    .randomBytes(6)
    .toString('hex')
    .toUpperCase();

  return `${prefix}-${randomId}`;
}

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { send } = require('process');
const { stat } = require('fs');
const { log, count } = require('console');
const { format } = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

//middleware
app.use(express.json());
app.use(cors());

const verifyFirebaseToken = async (req, res, next) => {

  console.log('headers in the middleware', req.headers.authorization);

  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

  try {

    const idToken = token.split(' ')[1];
    const decoded = await getAuth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();

  }

  catch (err) {

    return res.status(401).send({ message: 'unauthorized access' })

  }



}






//original url to connect with db
const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-z950sc6-shard-00-00.fs5atpa.mongodb.net:27017,ac-z950sc6-shard-00-01.fs5atpa.mongodb.net:27017,ac-z950sc6-shard-00-02.fs5atpa.mongodb.net:27017/?ssl=true&replicaSet=atlas-wdywmx-shard-0&authSource=admin&appName=Cluster0`;

//const uri=`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fs5atpa.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    console.log("MongoDB connected successfully!");

    const myDB = client.db("zap_shift_DB");
    const parcelCollection = myDB.collection("parcels");
    const paymentCollection = myDB.collection('payments');
    const userCollection = myDB.collection('users');
    const ridersCollection = myDB.collection('riders');
    const trackingsCollection = myDB.collection('trackings');


    //middleware with database access
    const verifyAdmin = async (req, res, next) => {

      const email = req.decoded_email;

      const query = { email };

      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'admin') {

        return res.status(403).send({ message: 'forbidden access' })

      }




      next();

    }

    const verifyRider = async (req, res, next) => {

      const email = req.decoded_email;

      const query = { email };

      const user = await userCollection.findOne(query);

      if (!user || user.role !== 'rider') {

        return res.status(403).send({ message: 'forbidden access' })

      }




      next();

    }



    const logTracking = async (trackingId, status) => {

      const log = {
        trackingId,
        status,
        details: status.split('_').join(' '),
        createdAt: new Date()
      }

      const result = await trackingsCollection.insertOne(log);
      return result;

    }




    // getting all the data from database
    app.get('/parcels', async (req, res) => {

      const query = {};

      //query parameter
      const { email, deliveryStatus } = req.query;
      if (email) {
        query.sendersEmail = email;
      }

      // assign rider by there delivery status, if delivery status then put it into the query 
      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      //////////////////

      //sort
      const options = { sort: { createdAt: -1 } };

      const cursor = parcelCollection.find(query, options);

      const result = await cursor.toArray();

      res.send(result);



    })

    //getting parcel data for rider
    app.get('/parcels/rider', async (req, res) => {

      const { riderEmail, deliveryStatus } = req.query;


      const query = {};

      if (riderEmail) {
        query.riderEmail = riderEmail;
      }

      if (deliveryStatus !== 'parcel_delivered') {
        //query.deliveryStatus={$in: ['driver_assigned', 'rider_arriving']};
        query.deliveryStatus = { $nin: ['parcel_delivered'] };
        //query.deliveryStatus=deliveryStatus;
      }

      else {
        query.deliveryStatus = deliveryStatus;
      }

      const cursor = parcelCollection.find(query);

      const result = await cursor.toArray();

      res.send(result);

    })


    //     const { riderEmail, deliveryStatus } = req.query;

    //     console.log("riderEmail:", riderEmail);
    //     console.log("deliveryStatus:", deliveryStatus);

    //     // Test 1
    //     const byEmail = await parcelCollection.find({
    //         riderEmail: riderEmail
    //     }).toArray();

    //     console.log("BY EMAIL:", byEmail);

    //     // Test 2
    //     const byStatus = await parcelCollection.find({
    //         deliveryStatus: deliveryStatus
    //     }).toArray();

    //     console.log("BY STATUS:", byStatus);

    //     // Test 3
    //     const both = await parcelCollection.find({
    //         riderEmail: riderEmail,
    //         deliveryStatus: deliveryStatus
    //     }).toArray();

    //     console.log("BOTH:", both);

    //     res.send(both);
    // });



    //getting single data from database



    app.get('/parcels/:id', async (req, res) => {

      const id = req.params.id;

      const query = { _id: new ObjectId(id) };

      const result = await parcelCollection.findOne(query)

      res.send(result);





    })


    app.get('/parcels/delivery-status/stats', async(req, res) => {

      const pipeline = [
        {
          $group:

          {
            _id: '$deliveryStatus',
            count: {$sum: 1}

          }

          
        },

        {
            $project:{
                 status: '$_id',
                 count: 1
                 // _id: 0 to hide id
            }
        }
      ]

      const result = await parcelCollection.aggregate(pipeline).toArray();
      
      res.send(result);

    });





    //posting data to the database
    app.post('/parcels', async (req, res) => {
      const parcel = req.body;

      const trackingId = generateTrackingId();

      console.log("PARCEL RECEIVED:", parcel);
      parcel.createdAt = new Date();
      parcel.paymentStatus = 'pending';

      parcel.trackingId = trackingId;

      logTracking(trackingId, 'parcel_created');

      const result = await parcelCollection.insertOne(parcel);
      console.log("INSERT RESULT:", result);
      res.send(result);
    })


    //this api works for riders side parcels pending pickup
    app.patch('/parcels/:id/status', async (req, res) => {

      const { deliveryStatus, riderId, trackingId } = req.body;

      const query = { _id: new ObjectId(req.params.id) }

      const updatedDoc = {
        $set: {
          deliveryStatus: deliveryStatus
        }
      }

      if (deliveryStatus === 'parcel_delivered') {

        const riderQuery = { _id: new ObjectId(riderId) }

        const riderUpdatedDoc = {
          $set: {
            workStatus: 'available'
          }
        }

        const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc);

      }

      const result = await parcelCollection.updateOne(query, updatedDoc);

      //log tracking
      logTracking(trackingId, deliveryStatus);

      res.send(result);


    })

    //deleting single data in the database
    app.delete('/parcels/:id', async (req, res) => {

      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await parcelCollection.deleteOne(query);
      res.send(result);

    })

    //Assign riders patch for parcels (generic)
    app.patch('/parcels/:id', verifyFirebaseToken, async (req, res) => {

      const { parcelId, riderId, riderName, riderEmail, trackingId } = req.body;

      const id = req.params.id;

      const query = { _id: new ObjectId(id) }

      const updatedDoc = {

        $set: {

          deliveryStatus: 'driver_assigned',
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail


        }
      }

      const result = await parcelCollection.updateOne(query, updatedDoc);

      //update rider info

      const riderQuery = { _id: new ObjectId(riderId) }

      const riderUpdatedDoc = {
        $set: {
          workStatus: 'in_delivery'
        }
      }

      const riderResult = await ridersCollection.updateOne(riderQuery, riderUpdatedDoc);

      //log tracking
      logTracking(trackingId, 'parcel_paid');

      res.send(riderResult);

    })

    //posting stripe payment data to the database
    app.post('/create-checkout-session', async (req, res) => {

      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({

        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${paymentInfo.parcelName}`,

              }
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.sendersEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          //parcelName: paymentInfo.parcelName,
          trackingId: paymentInfo.trackingId
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        // Provide a name (for example, hosted_web_0001) to label this Checkout integration and measure its conversion independently

      });

      console.log(session);
      res.send({ url: session.url })

    })

    //
    app.patch('/payment-success', async (req, res) => {

      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      //console.log('session retrieve',session)

      //this function stops repeat entry in database//
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);

      //console.log(paymentExist);

      if (paymentExist) {
        return res.send({
          message: 'already Exist',
          transactionId,
          trackingId: paymentExist.trackingId
        })
      }
      ////////////////////this function stops repeat entry in database//////////////////////

      //use the previous tracking id created during the parcel create which was set to the session metadata during session
      const trackingId = session.metadata.trackingId;

      if (session.payment_status === 'paid') {

        const id = session.metadata.parcelId;

        const query = { _id: new ObjectId(id) }

        const update = {
          $set: {
            paymentStatus: 'paid',
            deliveryStatus: 'pending-pickup',


          }
        }

        const result = await parcelCollection.updateOne(query, update);

        const payment = {

          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId





        }

        if (session.payment_status === 'paid') {

          const resultPayment = await paymentCollection.insertOne(payment);

          logTracking(trackingId, 'pending-pickup');

          return res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment

          })

        }

        // res.send(result);

      }
      return res.send({ success: false })

    });






    // get all the payment history data
    app.get('/payments', verifyFirebaseToken, async (req, res) => {

      const email = req.query.email;

      const query = {};

      ///////////////////////
      console.log('headers', req.headers);

      if (email) {
        query.customerEmail = email;

        //check email address
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);

    })


    //users related API
    app.post('/users', async (req, res) => {

      const user = req.body;

      console.log(user);

      user.role = 'user';

      user.createdAt = new Date();

      const email = user.email;

      //check user exist or not
      const userExists = await userCollection.findOne({ email })
      if (userExists) {
        return res.send({ message: 'User exist' })
      }
      ///////////////////////////////

      const result = await userCollection.insertOne(user);

      res.send(result);


    })

    //riders related api to get from database
    app.get('/riders', verifyFirebaseToken, verifyAdmin, async (req, res) => {

      //console.log('please............... check',req.query);
      console.log({ ...req.query });

      /////this is for modal//////
      const { status, district, workStatus } = req.query;
      /////////...............///////////

      const query = {};

      if (status) {
        query.status = status;
      }

      //////////this is for modal/////////////

      if (district) {

        query.ridersDistrict = district;

      }

      if (workStatus) {
        query.workStatus = workStatus;
      }

      console.log("RIDER QUERY:", query);

      //////this is for modal///////

      const cursor = ridersCollection.find(query)

      const result = await cursor.toArray();

      console.log("RIDER RESULT:", result);

      res.send(result);

    })

    app.get('/riders/delivery-per-day',async(req,res)=>{

       const email=req.query.email;

       //aggregate on parcel
       const pipeline=[

          {
             $match: {
               riderEmail: email,
               deliveryStatus: 'parcel_delivered'
           }
          },

          {
            $lookup:{
              from: 'trackings',
              localField: 'trackingId',
              foreignField: 'trackingId',
              as: 'parcel_trackings'
            }
          },
          
          {

            $unwind: '$parcel_trackings'

          },

          {
            $match:{
              'parcel_trackings.status':'parcel_delivered'
            }
          },

          {
            $addFields: {
              deliveryDay: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$parcel_trackings.createdAt'
                }
              }
            }
          },

          {
            $group: {
              _id: '$deliveryDay',
              deliveredCount: {$sum: 1}
            }
          }

       ]

       const result = await parcelCollection.aggregate(pipeline).toArray();

       res.send(result);



    })

    //riders related api to post to the database
    app.post('/riders', async (req, res) => {

      const rider = req.body;

      rider.status = 'pending',

        rider.createdAt = new Date();

      const result = await ridersCollection.insertOne(rider);

      res.send(result);

    })


    //riders related api to patch
    app.patch('/riders/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {

      const status = req.body.status;

      const id = req.params.id;

      const query = { _id: new ObjectId(id) }

      const updatedDoc = {
        $set: {
          status: status,
          workStatus: 'available'
        }
      }

      const result = await ridersCollection.updateOne(query, updatedDoc);

      if (status === 'approved') {
        const email = req.body.email;

        console.log(email);

        const userQuery = { email }

        console.log(userQuery);

        const updateUser = {

          $set: {
            role: 'rider'
          }

        }

        const userResult = await userCollection.updateOne(userQuery, updateUser);


        console.log(userResult);



      }

      res.send(result);


    })


    //users related api to get data
    app.get('/users', verifyFirebaseToken, verifyAdmin, async (req, res) => {


      /////////////Search Text///////////////
      const searchText = req.query.searchText;
      const query = {};
      if (searchText) {
        //query.displayName={$regex: searchText, $options: 'i'};

        query.$or = [
          { displayName: { $regex: searchText, $options: 'i' } },
          { email: { $regex: searchText, $options: 'i' } },
        ]
      }
      ////////////............//////////////

      const cursor = userCollection.find(query).limit(5).sort({ createdAt: -1 });

      const result = await cursor.toArray();

      res.send(result);



    })

    // user related api that make user an admin

    app.patch('/users/:id/role', verifyFirebaseToken, verifyAdmin, async (req, res) => {

      const id = req.params.id;

      const roleInfo = req.body;

      const query = { _id: new ObjectId(id) }

      const updatedDoc = {
        $set: {
          role: roleInfo.role

        }
      }

      const result = await userCollection.updateOne(query, updatedDoc);

      res.send(result);




    })


    //user related api
    app.get('/users/:id', (req, res) => {

    })

    //users related api
    app.get('/users/:email/role', async (req, res) => {

      const email = req.params.email;

      const query = { email }

      const user = await userCollection.findOne(query);

      res.send({ role: user?.role || 'user' })
    })


    //tracking related Apis
    app.get('/trackings/:trackingId/logs', async (req, res) => {
      const trackingId = req.params.trackingId;
      const query = { trackingId };
      const result = await trackingsCollection.find(query).toArray();
      res.send(result);
    })





    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})