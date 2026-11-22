import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import { errorHandler } from './errorHandler.js';

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(errorHandler(401, 'Unauthorized: Authentication token missing'));
    }

    const token = authHeader.split(' ')[1]?.trim();
    if (!token || token === 'null' || token === 'undefined') {
      return next(errorHandler(401, 'Unauthorized: Invalid token'));
    }

    if (!process.env.JWT_SECRET) {
      return next(errorHandler(500, 'Server authentication configuration error'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(errorHandler(401, 'Session expired. Please sign in again.'));
      }
      return next(errorHandler(401, 'Invalid authentication token. Please sign in again.'));
    }

    const user = await User.findById(decoded.id).select('_id userName email mobile role approved').lean();
    if (!user) {
      return next(errorHandler(401, 'User account no longer exists.'));
    }

    req.user = {
      id: user._id.toString(),
      _id: user._id,
      userName: user.userName,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      approved: Boolean(user.approved),
    };

    // Sliding session renewal: silently issue a fresh 30d token if current token is > 1 day old or < 15 days from expiry
    const nowSec = Math.floor(Date.now() / 1000);
    const issuedAgeSec = decoded.iat ? nowSec - decoded.iat : 0;
    const remainingSec = decoded.exp ? decoded.exp - nowSec : 0;
    if (issuedAgeSec > 24 * 60 * 60 || remainingSec < 15 * 24 * 60 * 60) {
      const freshToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '30d',
      });
      res.setHeader('X-Refreshed-Token', freshToken);
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const verifyApproved = (req, res, next) => {
  if (!req.user) {
    return next(errorHandler(401, 'Unauthorized'));
  }
  if (!req.user.approved && req.user.role !== 'admin') {
    return next(errorHandler(403, 'Your account is pending admin approval.'));
  }
  next();
};

export const verifyAdmin = (req, res, next) => {
  if (!req.user) {
    return next(errorHandler(401, 'Unauthorized'));
  }
  if (req.user.role !== 'admin') {
    return next(errorHandler(403, 'Admin privileges required.'));
  }
  next();
};
