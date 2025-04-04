import Collection from "../models/collectionModel.js"
import Customer from "../models/customerModel.js"
import Plan from "../models/planModel.js"
import { errorHandler } from "../uitils/errorHandler.js"

import XLSX from "xlsx"



const createCustomer = async(req,res,next)=>{
    try {
        let {name,mobile,address,planId,advanceAmount,remainingBalance} = req.body
        let {id} = req.user
        let isMobile = await Customer.find({name})
        if(isMobile.length >0 ) return next(errorHandler(401,'Name already registered'))

        let newCustomer = new Customer({name,mobile,address,advanceAmount,planId,createdBy:id,remainingBalance})
       await newCustomer.save()
       
       res.status(201).json({
        message:'Customer added Success',
        newCustomer
       })

    } catch (error) {
        next(error)
    }
}
const bulkCreateCustomers = async (req, res, next) => {
    try {
      if (!req.file) return next(errorHandler(400, "Please upload an Excel file"));
  
      // Read Excel file
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const customersData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const plans = await Plan.find();
      const planMap = {}; // Create a lookup object
  
      // Fill lookup object with plan names mapped to their IDs
      plans.forEach(plan => {
        planMap[plan.name.toLowerCase()] = plan._id; // Store in lowercase for case-insensitive matching
      });
  
      // Extract and format customer data
      const customers = customersData.map(row => {
        const planName = row["Package Name"] ? row["Package Name"].toLowerCase().trim() : "";
        return {
          name: row["Username"],
          mobile: String(row["Mobile"]).trim(), // Ensure mobile is a string
          address: row["Installation Address"],
          planId: planMap[planName] || null, // Replace plan name with ID, or set to null if not found
          advanceAmount: Number(row["Advance Amount"]) || 0,
          remainingBalance: Number(row["Remaining Balance"]) || 0,
          createdBy: req.user.id,
        };
      });
      const validCustomers = customers.filter(c => c.planId !== null);
      const invalidCustomers = customers.filter(c => c.planId === null);
      // Find existing customers by mobile number
      // Find existing customers by mobile number
      const existingMobiles = await Customer.find({ name: { $in: validCustomers.map(c => c.name) } });
      const existingNumbers = new Set(existingMobiles.map(c => c.name));
  
      // Separate new and duplicate customers
      const newCustomers = validCustomers.filter(c => !existingNumbers.has(c.name));
      const duplicateCustomers = validCustomers.filter(c => existingNumbers.has(c.name));
  
      // Insert only new customers
      let insertedCustomers = [];
      if (newCustomers.length > 0) {
        insertedCustomers = await Customer.insertMany(newCustomers);
      }
  
      res.status(201).json({
        message: `${insertedCustomers.length} customers added successfully`,
        inserted: insertedCustomers.length,
        duplicates: duplicateCustomers.length,
        invalidPlans: invalidCustomers.length,
        invalidCustomers, // List of customers with invalid plan names
        duplicateCustomers, // List of duplicate entries
      });
    } catch (error) {
        // console.log(error)
      next(error);
    }
  };

const getAllCustomer = async(req,res,next)=>{
    try {
        let customer = await Customer.find().populate({
            path: "transactions.collectedBy",
            model: "user",
            select: "userName _id"
        }).lean();
        // console.log(customer)
        res.status(200).json({
            message:"All customer",
            customer

        })

    } catch (error) {
        next(error)
    }
}

const changePlan = async(req,res,next)=>{
    try {
        let id = req.params.id
        let {planId,advanceAmount,remainingBalance} = req.body
        let isPlan = await Plan.findById(planId)
        let cust = await Customer.findById(id)
        if (!cust) return next(errorHandler(404, "Customer Not Found"));
        let transactions = [];

        if (cust.advanceAmount !== advanceAmount) {
            transactions.push({
                type: "advance",
                amount: advanceAmount ,
                collectedBy:req.user.id
            });
        }

        // Compare and log remaining balance changes
        if (cust.remainingBalance !== remainingBalance) {
            transactions.push({
                type: "remainbalance",
                amount: remainingBalance , // Difference in remaining balance
                collectedBy:req.user.id
            });
        }

     
          
      

        if(!isPlan ) return next(errorHandler(401,"plan Does not exist"))
            

            let updatedCustomer = await Customer.findByIdAndUpdate(
                id,
                { planId, advanceAmount, remainingBalance, $push: { transactions: { $each: transactions } } },
                { new: true }
            );
    
            if (!updatedCustomer) return next(errorHandler(401, "Customer Not Found"));

      
        
            res.status(200).json({
                message:"customer Edited Success"
            })
        
    } catch (error) {
        next(error)
    }
}

const deleteCustomer = async(req,res,next)=>{
    try {
        let id = req.params.id
         let customerExist = await Customer.findById(id)
                if( !customerExist) return next(errorHandler(401,'customer not found'))
                    await Collection.deleteMany({customerId:id})
         await Customer.findByIdAndDelete({_id:id})
        res.status(200).json({
            message:"customer deleted Success"
        })
    } catch (error) {
        next(error)
    }
}

/*  
        let customers = await Customer.find()
            .populate({
                path: 'transactions.collectedBy',  // Populate collectedBy field inside transactions
                select: 'userName'  // Only fetch the userName field
            });

        res.status(200).json({
            message: "Last 20 Transactions (excluding 'due')",
            transactions: customers.flatMap(customer =>
                customer.transactions
                    .filter(t => t.type !== "due")  // Exclude 'due' transactions
                    .map(t => ({
                        customerName: customer.name,
                        date: t.date,
                        type: t.type,
                        amount: t.amount,
                        collectedBy: t.collectedBy ? { _id: t.collectedBy._id, userName: t.collectedBy.userName } : null
                    }))
            ).slice(-20) // Limit to last 20 transactions
        });
       
        // let transactions = await Customer.aggregate([
        //     { $unwind: "$transactions" }, // Convert transactions array into separate documents
        //     { $match: { "transactions.type": { $ne: "due" } } }, // Exclude transactions with type "due"
        //     { $sort: { "transactions.date": -1 } }, // Sort transactions by latest date
        //     { $limit: 20 }, // Get the last 20 transactions
        //     { 
        //         $lookup: { // Populate collectedBy field from the User model
        //             from: "user",
        //             localField: "transactions.collectedBy",
        //             foreignField: "_id",
        //             as: "transactions.collectedBy"
        //         }
        //     },
        //     { 
        //         $unwind: { path: "$transactions.collectedBy", preserveNullAndEmptyArrays: true } // Ensure collectedBy is structured properly
        //     },
        //     {
        //         $project: { // Select only required fields
        //             _id: 0,
        //             "transactions.date": 1,
        //             "transactions.type": 1,
        //             "transactions.amount": 1,
        //             "transactions.collectedBy._id": 1,
        //             "transactions.collectedBy.userName": 1
        //         }
        //     }
        // ]);

        // res.status(200).json({
        //     message: "Last 20 Transactions (excluding 'due')",
        //     transactions
        // });
   */
const getLast20Transactions = async (req, res, next) => {
    try {  const transactions = await Customer.aggregate([
        { $unwind: "$transactions" }, // Separate each transaction
        { $match: { "transactions.type": { $ne: "due" } } }, // Exclude 'due'
        { $sort: { "transactions.date": -1 } }, // Sort by latest date
        { $limit: 20 }, // Get only top 20
        {
          $lookup: {
            from: "users", // Make sure your collection name is correct ("users", not "user")
            localField: "transactions.collectedBy",
            foreignField: "_id",
            as: "collectedBy"
          }
        },
        {
          $unwind: { path: "$collectedBy", preserveNullAndEmptyArrays: true }
        },
        {
          $project: {
            _id: 0,
            customerName: "$name",
            date: "$transactions.date",
            type: "$transactions.type",
            amount: "$transactions.amount",
            collectedBy: {
              _id: "$collectedBy._id",
              userName: "$collectedBy.userName"
            }
          }
        }
      ]);
  
      res.status(200).json({
        message: "Latest 20 Transactions (excluding 'due')",
        transactions
      });} catch (error) {
        next(error);
    }
};
const getCurrentMonthCollectionByStaff = async (req, res, next) => {
    try {
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)
        let result = await Customer.aggregate([
            { $unwind: "$transactions" }, // Flatten transactions array
            { 
                $match: { 
                    "transactions.type": { $in: ["payment", "advance"] }, // Include 'payment' & 'advance'
                    "transactions.date": { 
                        $gte: firstDayOfMonth, 
                        $lte: lastDayOfMonth 
                    } // Filter transactions within the current month
                } 
            },
            { 
                $group: {
                    _id: { 
                        day: { $dayOfMonth: "$transactions.date" }, 
                        collectedBy: "$transactions.collectedBy",
                        type: "$transactions.type" // Group separately for 'payment' and 'advance'
                    },
                    totalCollected: { $sum: "$transactions.amount" } // Sum amount for each type
                }
            },
            { 
                $lookup: { 
                    from: "users", 
                    localField: "_id.collectedBy", 
                    foreignField: "_id", 
                    as: "collectorInfo" 
                } 
            },
            { 
                $unwind: { 
                    path: "$collectorInfo", 
                    preserveNullAndEmptyArrays: true 
                } 
            },
            { 
                $project: {
                    _id: 0,
                    day: "$_id.day",
                    collectedBy: {
                        _id: "$_id.collectedBy",
                        userName: "$collectorInfo.userName" // Fetch staff name
                    },
                    type: "$_id.type", // Show whether it's 'payment' or 'advance'
                    totalCollected: 1
                }
            },
            { $sort: { day: 1, type: 1 } } // Sort by day, then type
        ]);

        res.status(200).json({
            message: "Current Month Staff-wise and Day-wise Collection (Including Advance)",
            data: result
        });

    } catch (error) {
        next(error);
    }
};




export default {
    createCustomer,
    changePlan,
    deleteCustomer,
    getAllCustomer,
    bulkCreateCustomers,
    getLast20Transactions,
    getCurrentMonthCollectionByStaff
}