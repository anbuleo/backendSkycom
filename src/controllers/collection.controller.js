import Collection from "../models/collectionModel.js";
import Customer from "../models/customerModel.js";
import Plan from "../models/planModel.js";
import { errorHandler } from "../uitils/errorHandler.js";
import XLSX from "xlsx"; 
import fs from "fs";


const generateMonthlyCollectionss = async (req, res, next) => {
    try {
        const customers = await Customer.find();
        if (!customers.length) {
            console.log("No customers found.");
            return res.status(200).json({ message: "No customers found." });
        }

        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();

        // Fetch all plans in one go (avoid multiple queries)
        const planIds = customers.map(customer => customer.planId);
        const plans = await Plan.find({ _id: { $in: planIds } }).lean();
        const planMap = plans.reduce((acc, plan) => {
            acc[plan._id] = plan.amount;  // Store plan amount by ID
            return acc;
        }, {});

        const bulkCustomerUpdates = [];
        const newCollections = [];

        await Promise.all(customers.map(async (customer) => {
            const existingCollection = await Collection.findOne({ customerId: customer._id, month, year });

            if (!existingCollection) {
                let statusPay = "Pending";
                let monthlyCharge = Number(planMap[customer.planId] || 0); // Get charge from map
                let totalDue = monthlyCharge;
                let remainingAmount = 0;

                // Deduct advanceAmount first
                if (customer.advanceAmount > 0) {
                    if (customer.advanceAmount >= totalDue) {
                        customer.advanceAmount -= totalDue;
                        statusPay = "Paid";
                        totalDue = 0;
                    } else {
                        totalDue -= customer.advanceAmount;
                        customer.advanceAmount = 0;
                    }
                }

                // Deduct remaining balance
                if (customer.remainingBalance > 0) {
                    totalDue += customer.remainingBalance;
                    customer.remainingBalance = 0;
                }

                if (totalDue > 0) {
                    remainingAmount = totalDue;
                }

                newCollections.push({
                    userId: customer.createdBy,
                    customerId: customer._id,
                    amountDue: totalDue,
                    amountPaid: 0,
                    dueDate: new Date(year, month - 1, 10),
                    month,
                    year,
                    status: statusPay,
                });

                bulkCustomerUpdates.push({
                    updateOne: {
                        filter: { _id: customer._id },
                        update: {
                            $set: { remainingBalance: remainingAmount,advanceAmount: customer.advanceAmount },
                            $push: { transactions: { type: 'due', amount: totalDue } }
                        }
                    }
                });

                console.log(`Bill generated for ${customer.name}. Due: ₹${totalDue}`);
            } else {
                console.log(`Bill for ${customer.name} already exists.`);
            }
        }));

        // Insert all collections in one batch
        if (newCollections.length) {
            await Collection.insertMany(newCollections);
        }

        // Update customers in one batch
        if (bulkCustomerUpdates.length) {
            await Customer.bulkWrite(bulkCustomerUpdates);
        }

        res.status(200).json({ message: "Monthly collections generated successfully" });
    } catch (error) {
        console.error("Error generating monthly bills:", error);
        next(error);
    }
};



export const generateMonthlyCollections = async () => {
    try {
        const customers = await Customer.find();
        let statusPay = "Pending"

        if (!customers.length) {
            console.log("No customers found.");
            return;
        }

        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();

        for (const customer of customers) {
            const existingCollection = await Collection.findOne({ customerId: customer._id, month, year });

            if (!existingCollection) {
                let payable =await Plan.findById({_id:customer.planId})
                let monthlyCharge = Number(payable.amount); // Default monthly charge
                let totalDue = monthlyCharge;
                let remainingAmount = 0;

                // Deduct advanceAmount first
                if (customer.advanceAmount > 0) {
                    if (customer.advanceAmount >= totalDue) {
                        customer.advanceAmount -= totalDue;
                        statusPay = "Paid"

                        totalDue = 0;
                    } else {
                        totalDue -= customer.advanceAmount;
                        customer.advanceAmount = 0;
                    }
                }

                // Deduct remaining balance (if any)
                if (customer.remainingBalance > 0) {
                    totalDue += customer.remainingBalance;
                    customer.remainingBalance = 0;
                }
                if (totalDue > 0) {
                    remainingAmount = totalDue;
                }

                const newCollection = new Collection({
                    userId: customer.createdBy,
                    customerId: customer._id,
                    amountDue: totalDue,
                    amountPaid: 0,
                    dueDate: new Date(year, month - 1, 10),
                    month,
                    year,
                    status:statusPay,
                   
                });
                customer.remainingBalance = remainingAmount; 
                customer. transactions.push({type:'due',amount:totalDue })

                await newCollection.save();
                await customer.save();

                console.log(`Bill generated for ${customer.name}. Due: ₹${totalDue}`);
            } else {
                console.log(`Bill for ${customer.name} already exists.`);
            }
        }
    } catch (error) {
        console.error("Error generating monthly bills:", error);
    }
};

const makePayment = async (req, res,next) => {
    try {
        const { collectionId, amountPaid, paymentMode ,transactionId} = req.body;

        const collection = await Collection.findById(collectionId);
        if (!collection) return res.status(404).json({ message: "Bill not found" });

        const customer = await Customer.findById(collection.customerId);
        if (!customer) return res.status(404).json({ message: "Customer not found" });

        let remainingDue = collection.amountDue  - Number(amountPaid);

        if (remainingDue <= 0) {
            
            collection.status = "Paid";
            customer.advanceAmount += Math.abs(remainingDue);
            collection.amountDue = 0; // Store extra payment as advance
            customer.remainingBalance = 0;
        } else if (remainingDue > 0) {
            collection.status = "Pending";
            collection.amountDue = remainingDue;
            customer.remainingBalance = remainingDue; // Store unpaid amount as remaining balance
        }else {
            // Exact payment: Mark as Paid
            collection.status = "Paid";
            collection.amountDue = 0; //
            customer.remainingBalance = 0;
        }

        collection.amountPaid += Number(amountPaid);
        collection.paymentMode = paymentMode || "cash";
        collection.transactionId = transactionId || null;
        if(collection.paymentMode ==="online" && !transactionId)return next(errorHandler(400,"enter Transaction Id"))
        
            if (req.user) {
                collection.userId = req.user.id;
            }
            customer. transactions.push({ type: 'payment', amount: amountPaid, collectedBy: req.user.id });
        await collection.save();
        await customer.save();

        res.status(200).json({ message: "Payment successful", collection, customer });
    } catch (error) {
    console.log(error)
        res.status(500).json({ message: "Error processing payment", error });
    }
};
const getOverduePayments = async (req, res) => {
    try {
        const { customerId } = req.query;
        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();

        let filter = { status: "Overdue", $or: [{ year: { $lt: year } }, { month: { $lt: month }, year }] };
        if (customerId) filter.customerId = customerId;

        const overduePayments = await Collection.find(filter).populate("customerId", "name mobile");

        res.status(200).json({ message: "Overdue payments fetched", data: overduePayments });
    } catch (error) {
    console.log(error)
        res.status(500).json({ message: "Error fetching overdue payments", error });
    }
};
const getPendingPayments = async (req, res) => {
    try {
        const { customerId } = req.query;
        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();

        let filter = { status: "Pending", month, year };
        if (customerId) filter.customerId = customerId;

        const pendingPayments = await Collection.find(filter).populate("customerId", "name mobile");

        res.status(200).json({ message: "Pending payments fetched", data: pendingPayments });
    } catch (error) {
        res.status(500).json({ message: "Error fetching pending payments", error });
    }
};

const getcurrentmonthcollection = async(req,res,next)=>{
    try {
        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();
        const startOfMonth = new Date(year, month - 1, 1); // First day of the month
        const endOfMonth = new Date(year, month, 0, 23, 59, 59);
        
    const collection = await Collection.find({
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
      }).populate("customerId", "name mobile");
      res.status(200).json({ message: "current month all data",  collection });
        
    } catch (error) {
        next(error)
    }
}
const getAllCollections = async (req, res,next) => {
    try {
        const collections = await Collection.find()
            .populate("customerId", "name mobile") // Populate customer details
            .sort({ updatedAt: -1 }); // Sort by latest payment update

        res.status(200).json({ success: true, collections });
    } catch (error) {
        next(error)
    }
};
const getMonthWiseReport = async (req, res) => {
    try {
        const report = await Collection.aggregate([
            {
                $group: {
                    _id: { year: "$year", month: "$month" },
                    totalAmountDue: { $sum: "$amountDue" },
                    totalAmountPaid: { $sum: "$amountPaid" },
                    totalPending: { 
                        $sum: { 
                            $max: [ 0, { $subtract: ["$amountDue", "$amountPaid"] } ] 
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": -1, "_id.month": -1 } } // Latest months first
        ]);

        res.status(200).json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error generating report", error });
    }
};
const getTotalCollectionByAllPlans = async (req, res) => {
    try {
        const result = await Collection.aggregate([
            {
                $lookup: {
                    from: "customers",
                    localField: "customerId",
                    foreignField: "_id",
                    as: "customer"
                }
            },
            { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } }, 

            {
                $lookup: {
                    from: "plans",
                    localField: "customer.planId",
                    foreignField: "_id",
                    as: "planDetails"
                }
            },
            { $unwind: { path: "$planDetails", preserveNullAndEmptyArrays: true } }, 

            {
                $group: {
                    _id: "$planDetails._id",
                    planName: { $first: "$planDetails.name" },
                    totalAmountDue: { $sum: "$amountDue" },
                    totalCollected: { $sum: "$amountPaid" },
                    totalPending: { 
                        $sum: { 
                            $max: [0, { $subtract: ["$amountDue", "$amountPaid"] }] 
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    planId: "$_id",
                    planName: 1,
                    totalAmountDue: 1,
                    totalCollected: 1,
                    totalPending: 1
                }
            }
        ]);

        // console.log("Aggregation Result:", result); // Debugging log
        res.status(200).json({ success: true, result });
    } catch (error) {
        console.error("Aggregation Error:", error); // Debugging log
        res.status(500).json({ success: false, message: "Error fetching collection data", error });
    }
};
const getMonthlyCollectionByUser = async (req, res) => {
    try {
        const result = await Collection.aggregate([
            {
                $lookup: {
                    from: "users", // Reference to the user collection
                    localField: "userId",
                    foreignField: "_id",
                    as: "user"
                }
            },
            { $unwind: "$user" }, // Convert user array to an object
            {
                $group: {
                    _id: { userId: "$userId", userName: "$user.userName", year: "$year", month: "$month" },
                    totalCollected: { $sum: "$amountPaid" } // Total collected amount per user per month
                }
            },
            { $sort: { "_id.year": -1, "_id.month": -1 } }, // Sort by latest month first
            {
                $project: {
                    _id: 0,
                    userName: "$_id.userName",
                    month: "$_id.month",
                    year: "$_id.year",
                    totalCollected: 1
                }
            }
        ]);

        res.status(200).json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching monthly collection data", error });
    }
};

const downloadxl = async (req, res) => {
    try {
        const data = await Collection.aggregate([
            {
                $lookup: {
                    from: "customers",
                    localField: "customerId",
                    foreignField: "_id",
                    as: "customer"
                }
            },
            { $unwind: "$customer" },
            {
                $lookup: {
                    from: "users",
                    localField: "userId",
                    foreignField: "_id",
                    as: "user"
                }
            },
            { $unwind: "$user" },
            {
                $project: {
                    userName: "$user.userName",
                    customerName: "$customer.name",
                    amountDue: 1,
                    amountPaid: 1,
                    paymentMode: 1,
                    dueDate: 1,
                    status: 1,
                    month: 1,
                    year: 1
                }
            }
        ]);

        if (data.length === 0) {
            return res.status(404).json({ success: false, message: "No data found" });
        }

        // Convert JSON to Excel
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Collection Report");

        // Save the file locally
        const filePath = "./collection_report.xlsx";
        XLSX.writeFile(workbook, filePath);

        // Send file to frontend
        res.download(filePath, "Collection_Report.xlsx", (err) => {
            if (err) {
                console.error("File download error:", err);
                res.status(500).json({ success: false, message: "Error downloading file" });
            }

            // Delete file after sending
            fs.unlinkSync(filePath);
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching collection data", error });
    }
}




export default {
    makePayment,
    getcurrentmonthcollection,
    getAllCollections,
    getMonthWiseReport,
    getTotalCollectionByAllPlans,
    getMonthlyCollectionByUser,
    downloadxl,
    generateMonthlyCollectionss
}