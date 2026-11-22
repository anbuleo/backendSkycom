import Plan from '../models/planModel.js';
import Customer from '../models/customerModel.js';
import { errorHandler } from '../uitils/errorHandler.js';

const createPlan = async (req, res, next) => {
  try {
    const name = req.body.name?.trim();
    const amount = Number(req.body.amount);
    const speed = Number(req.body.speed);

    if (!name) return next(errorHandler(400, 'Plan name is required'));
    if (!Number.isFinite(amount) || amount <= 0) {
      return next(errorHandler(400, 'Plan amount must be a positive number'));
    }
    if (!Number.isFinite(speed) || speed <= 0) {
      return next(errorHandler(400, 'Plan speed must be a positive number'));
    }

    const existingPlan = await Plan.findOne({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });
    if (existingPlan) return next(errorHandler(409, 'A plan with this name already exists'));

    const newPlan = new Plan({ name, amount, speed });
    await newPlan.save();

    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      plan: newPlan,
    });
  } catch (error) {
    next(error);
  }
};

const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const planExist = await Plan.findById(id);
    if (!planExist) return next(errorHandler(404, 'Plan not found'));

    const assignedCustomers = await Customer.countDocuments({ planId: id });
    if (assignedCustomers > 0) {
      return next(
        errorHandler(
          400,
          `Cannot delete plan "${planExist.name}" because ${assignedCustomers} customer(s) are currently subscribed to it. Reassign them first.`
        )
      );
    }

    await Plan.findByIdAndDelete(id);
    res.status(200).json({
      success: true,
      message: 'Plan deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

const editPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const planExist = await Plan.findById(id);
    if (!planExist) return next(errorHandler(404, 'Plan not found'));

    const updateFields = {};
    if (req.body.name !== undefined) {
      const trimmedName = String(req.body.name).trim();
      if (!trimmedName) return next(errorHandler(400, 'Plan name cannot be empty'));
      const duplicate = await Plan.findOne({
        _id: { $ne: id },
        name: { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      });
      if (duplicate) return next(errorHandler(409, 'Another plan with this name already exists'));
      updateFields.name = trimmedName;
    }

    if (req.body.amount !== undefined) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return next(errorHandler(400, 'Plan amount must be a positive number'));
      }
      updateFields.amount = amount;
    }

    if (req.body.speed !== undefined) {
      const speed = Number(req.body.speed);
      if (!Number.isFinite(speed) || speed <= 0) {
        return next(errorHandler(400, 'Plan speed must be a positive number'));
      }
      updateFields.speed = speed;
    }

    const updatedPlan = await Plan.findByIdAndUpdate(id, updateFields, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: 'Plan updated successfully',
      plan: updatedPlan,
    });
  } catch (error) {
    next(error);
  }
};

const getAllPlan = async (req, res, next) => {
  try {
    const plan = await Plan.find().sort({ amount: 1 });
    res.status(200).json({
      success: true,
      plan,
      message: plan.length ? 'Plans fetched successfully' : 'No plans found',
    });
  } catch (error) {
    next(error);
  }
};

export default {
  createPlan,
  deletePlan,
  editPlan,
  getAllPlan,
};
