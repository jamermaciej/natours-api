const multer = require('multer');
const sharp = require('sharp');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const factory = require('./handlerFactory');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Email = require('./../utils/email');

// const multerStorage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     cb(null, 'public/img/users');
//   },
//   filename: (req, file, cb) => {
//     const ext = file.mimetype.split('/')[1];
//     cb(null, `user-${req.user.id}-${Date.now()}.${ext}`);
//   }
// });
const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload only images.', 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter
});

const generateStrongPasswordWithRules = (length = 14) => {
  const uppercase   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase   = 'abcdefghijklmnopqrstuvwxyz';
  const digits      = '0123456789';
  const special     = '!@#$%^&*()_+-=[]{};:,.<>?/~';

  const allChars = uppercase + lowercase + digits + special;

  let password = '';

  password += uppercase[crypto.randomBytes(1)[0] % uppercase.length];
  password += lowercase[crypto.randomBytes(1)[0] % lowercase.length];
  password += digits[crypto.randomBytes(1)[0]   % digits.length];
  password += special[crypto.randomBytes(1)[0]  % special.length];

  const remaining = length - 4;
  const randomBytes = crypto.randomBytes(remaining);
  
  for (let i = 0; i < remaining; i++) {
    password += allChars[randomBytes[i] % allChars.length];
  }

  password = password.split('')
    .sort(() => crypto.randomBytes(1)[0] % 2 ? 1 : -1)
    .join('');

  return password;
}

exports.uploadUserPhoto = upload.single('photo');

exports.resizeUserPhoto = catchAsync(async (req, res, next) => {
  if (!req.file) return next();

  req.file.filename = `user-${req.user.id}-${Date.now()}.jpeg`;

  await sharp(req.file.buffer)
    .resize(500, 500)
    .toFormat('jpeg')
    .jpeg({ quality: 90 })
    .toFile(`public/img/users/${req.file.filename}`);

  next();
});

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach(el => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};

exports.getMe = (req, res, next) => {
  req.params.id = req.user.id;
  next();
};

exports.updateMe = catchAsync(async (req, res, next) => {
  // 1) Create error if user POSTs password data
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates. Please use /updateMyPassword.',
        400
      )
    );
  }

  // 2) Filtered out unwanted fields names that are not allowed to be updated
  const filteredBody = filterObj(req.body, 'name', 'email');
  if (req.file) filteredBody.photo = req.file.filename;

  // 3) Update user document
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true
  });

  updatedUser.__v = undefined;

  res.status(200).json({
    status: 'success',
    data: {
      data: updatedUser
    }
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  res.status(204).json({
    status: 'success',
    data: null
  });
});

// exports.createUser = (req, res) => {
//   res.status(500).json({
//     status: 'error',
//     message: 'This route is not defined! Please use /signup instead'
//   });
// };

exports.createUser = catchAsync(async (req, res, next) => {
  // Check if user already exist
  const existingUser = await User.findOne({ email:req.body.email });
  if (existingUser) {
    return next(new AppError('User already exist, use another email.', 404));
  }

  // Generate temporary password
  // const tempPassword = crypto.randomBytes(6).toString('hex');
  const tempPassword = generateStrongPasswordWithRules();

  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    role: req.body.role,
    password: tempPassword,
    passwordConfirm: tempPassword
  });

  const url = `${req.protocol}://${req.get('host')}/`;
  await new Email(newUser, url, tempPassword).sendTemporaryPassword();

  newUser.password = undefined;
  newUser.__v = undefined;

  res.status(201).json({
    status: 'success',
    message: 'User created, password has been send to email address!',
    data: {
      data: newUser
    }
  });
});

exports.checkEmail = catchAsync(async (req, res, next) => {
  const { email, excludeId } = req.query;

  if (!email) {
    return next(new AppError('Email query parameter is missing.', 400));
  }

  const query = { email: email.toLowerCase() };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const existingUser = await User.findOne(query).select('_id');

  return res.status(200).json({
    exists: !!existingUser
  });
});

exports.getUser = factory.getOne(User);
exports.getAllUsers = factory.getAll(User, { path: 'users' });

// Do NOT update passwords with this!
exports.updateUser = factory.updateOne(User);
exports.deleteUser = factory.deleteOne(User);
