const Review = require('./../models/reviewModel');
const factory = require('./handlerFactory');
const catchAsync = require('./../utils/catchAsync');
const Booking = require('./../models/bookingModel');
const Tour = require('./../models/tourModel');
const AppError = require('./../utils/appError');

exports.setTourUserIds = (req, res, next) => {
  // Allow nested routes
  if (!req.body.tour) req.body.tour = req.params.tourId;
  if (!req.body.user) req.body.user = req.user.id;
  next();
};

exports.checkIsUserBooking = catchAsync(async (req, res, next) => {
  const bookings = await Booking.find({ user: req.body.user, tour: req.body.tour });

  if (!bookings.length) {
    return next(new AppError('You did not booked this tour, so you can not add review to this.', 403));
  }

  next();
});

exports.getMyReviews = catchAsync(async (req, res, next) => {
  const reviews = await Review.find({ user: req.user.id });

  if (!reviews) {
    return next(new AppError('No document found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    results: reviews.length,
    data: {
      data: reviews
    }
  });
});

exports.getAllReviews = factory.getAll(Review, { path: 'reviews' });
exports.getReview = factory.getOne(Review);
// exports.createReview = factory.createOne(Review);
exports.createReview = catchAsync(async (req, res, next) => {
  let doc = await Review.create(req.body);

  doc = await doc.populate({
    path: 'user',
    select: 'name photo'
  }).populate({
    path: 'tour',
    select: 'name slug'
  }).execPopulate();

  res.status(201).json({
    status: 'success',
    data: {
      data: doc
    }
  });
});
exports.updateReview = factory.updateOne(Review);
exports.deleteReview = factory.deleteOne(Review);
