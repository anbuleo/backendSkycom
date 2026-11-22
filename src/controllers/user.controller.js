import User from '../models/userModel.js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { errorHandler } from '../uitils/errorHandler.js';

const signUp = async (req, res, next) => {
  try {
    const userName = req.body.userName?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const mobile = String(req.body.mobile || '').trim();
    const password = req.body.password;

    if (!userName || !email || !mobile || !password) {
      return next(errorHandler(400, 'All fields (userName, email, mobile, password) are required'));
    }

    if (password.length < 6) {
      return next(errorHandler(400, 'Password must be at least 6 characters long'));
    }

    if (!/^\d{10}$/.test(mobile)) {
      return next(errorHandler(400, 'Mobile number must be a valid 10-digit number'));
    }

    const [existingName, existingEmail, existingMobile] = await Promise.all([
      User.findOne({
        userName: { $regex: `^${userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      }),
      User.findOne({ email }),
      User.findOne({ mobile }),
    ]);

    if (existingName) return next(errorHandler(409, 'Username already exists'));
    if (existingEmail) return next(errorHandler(409, 'Email already registered'));
    if (existingMobile) return next(errorHandler(409, 'Mobile number already registered'));

    const saltRounds = Number(process.env.SALT) || 10;
    const hashedPassword = bcryptjs.hashSync(password, saltRounds);

    const newUser = new User({
      userName,
      email,
      mobile,
      password: hashedPassword,
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      message: 'Account created successfully. Please wait for admin approval.',
    });
  } catch (error) {
    next(error);
  }
};

const signin = async (req, res, next) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return next(errorHandler(400, 'Email and password are required'));
    }

    const user = await User.findOne({
      email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });

    if (!user) return next(errorHandler(404, 'No account found with this email'));

    const validPassword = bcryptjs.compareSync(password, user.password);
    if (!validPassword) return next(errorHandler(401, 'Invalid email or password'));

    if (!process.env.JWT_SECRET) {
      return next(errorHandler(500, 'Server JWT configuration is missing'));
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '30d',
    });

    const { password: _pass, ...rest } = user._doc;
    res.status(200).json({ token, rest });
  } catch (error) {
    next(error);
  }
};

// Sliding / grace-period token refresh so active staff & admin sessions never unexpectedly log out
const refreshToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const rawToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]?.trim()
        : req.body?.token;

    if (!rawToken || rawToken === 'null' || rawToken === 'undefined') {
      return next(errorHandler(401, 'Authentication token missing'));
    }
    if (!process.env.JWT_SECRET) {
      return next(errorHandler(500, 'Server JWT configuration is missing'));
    }

    let decoded;
    try {
      // Verify signature while allowing recently-expired tokens within a 14-day grace window
      decoded = jwt.verify(rawToken, process.env.JWT_SECRET, { ignoreExpiration: true });
    } catch {
      return next(errorHandler(401, 'Invalid authentication token. Please sign in again.'));
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const graceWindowSec = 14 * 24 * 60 * 60;
    if (decoded.exp && nowSec - decoded.exp > graceWindowSec) {
      return next(errorHandler(401, 'Session expired. Please sign in again.'));
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return next(errorHandler(401, 'User account no longer exists.'));
    }

    const newToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '30d',
    });

    res.status(200).json({
      success: true,
      token: newToken,
      user,
    });
  } catch (error) {
    next(error);
  }
};

const getCurrentUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return next(errorHandler(404, 'User not found'));

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return next(errorHandler(400, 'Current password and new password are required'));
    }
    if (String(newPassword).length < 6) {
      return next(errorHandler(400, 'New password must be at least 6 characters long'));
    }

    const user = await User.findById(req.user.id);
    if (!user) return next(errorHandler(404, 'User not found'));

    const valid = bcryptjs.compareSync(currentPassword, user.password);
    if (!valid) return next(errorHandler(400, 'Current password is incorrect'));

    const saltRounds = Number(process.env.SALT) || 10;
    user.password = bcryptjs.hashSync(newPassword, saltRounds);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || String(newPassword).length < 6) {
      return next(errorHandler(400, 'New password must be at least 6 characters long'));
    }

    const targetUser = await User.findById(id);
    if (!targetUser) return next(errorHandler(404, 'User not found'));

    const saltRounds = Number(process.env.SALT) || 10;
    targetUser.password = bcryptjs.hashSync(newPassword, saltRounds);
    await targetUser.save();

    res.status(200).json({
      success: true,
      message: `Password reset successfully for ${targetUser.userName}`,
    });
  } catch (error) {
    next(error);
  }
};

const getAlluser = async (req, res, next) => {
  try {
    const user = await User.find().select('-password').sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      user,
    });
  } catch (error) {
    next(error);
  }
};

const adduser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const targetUser = await User.findById(id);
    if (!targetUser) return next(errorHandler(404, 'User not found'));

    const nextApproved = typeof req.body?.approved === 'boolean' ? req.body.approved : true;

    if (!nextApproved && (targetUser._id.toString() === req.user.id || targetUser.role === 'admin')) {
      return next(errorHandler(400, 'Cannot revoke approval for an admin account'));
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { approved: nextApproved },
      { new: true }
    ).select('-password');

    res.status(200).json({
      success: true,
      message: nextApproved
        ? 'User approved as staff successfully'
        : 'User approval revoked successfully',
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

const updateUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['staff', 'admin'].includes(role)) {
      return next(errorHandler(400, 'Role must be either "staff" or "admin"'));
    }

    const targetUser = await User.findById(id);
    if (!targetUser) return next(errorHandler(404, 'User not found'));

    if (targetUser._id.toString() === req.user.id && role !== 'admin') {
      return next(errorHandler(400, 'You cannot demote your own admin account'));
    }

    if (targetUser.role === 'admin' && role === 'staff') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return next(errorHandler(400, 'At least one admin account must remain'));
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { role, ...(role === 'admin' ? { approved: true } : {}) },
      { new: true }
    ).select('-password');

    res.status(200).json({
      success: true,
      message: `${updatedUser.userName} is now ${role}`,
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const targetUser = await User.findById(id);
    if (!targetUser) return next(errorHandler(404, 'User not found'));

    if (targetUser._id.toString() === req.user.id || targetUser.role === 'admin') {
      return next(errorHandler(400, 'Admin accounts cannot be deleted'));
    }

    await User.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: `User "${targetUser.userName}" deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  signUp,
  signin,
  refreshToken,
  getCurrentUser,
  changePassword,
  resetPassword,
  getAlluser,
  adduser,
  updateUserRole,
  deleteUser,
};
