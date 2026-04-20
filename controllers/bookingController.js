const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Tour = require('../models/tourModel');
const User = require('../models/userModel');
const Booking = require('../models/bookingModel');
const catchAsync = require('../utils/catchAsync');
const factory = require('./handlerFactory');
const dayjs = require('dayjs');
const AppError = require('./../utils/appError');
const Review = require('./../models/reviewModel');

exports.getCheckoutSession = catchAsync(async (req, res, next) => {
  // 1) Get the currently booked tour
  const tour = await Tour.findById(req.params.tourId);
  // console.log(tour);

  // 2) Create checkout session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    // Dev
    // success_url: `${req.protocol}://${req.get('host')}/my-tours/?tour=${
    //   req.params.tourId
    // }&user=${req.user.id}&price=${tour.price}&date=${req.params.date}`,
    // success_url: `${req.protocol}://${req.get('host')}/my-tours/?tour=${
    //   req.params.tourId
    // }&user=${req.user.id}&price=${tour.price}`,
    // success_url: `${req.protocol}://${req.get('host')}/my-tours?alert=booking`,
    // success_url: `${req.protocol}://localhost:4202/profile/bookings`,
    success_url: `${process.env.CORS_ORIGIN ||
      'https://localhost:4202'}/my-tours`,
    cancel_url: `${process.env.CORS_ORIGIN || 'https://localhost:4202'}/tour/${
      tour.slug
    }`,
    customer_email: req.user.email,
    client_reference_id: JSON.stringify({
      tourId: req.params.tourId,
      userId: req.user.id,
      date: req.params.date
    }),
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: tour.price * 100,
          product_data: {
            name: `${tour.name} Tour`,
            description: tour.summary,
            images: [
              `${req.protocol}://${req.get('host')}/img/tours/${
                tour.imageCover
              }`
            ]
          }
        },
        quantity: 1
      }
    ]
  });

  // 3) Create session as response
  res.status(200).json({
    status: 'success',
    session
  });
});

// exports.createBookingCheckout = catchAsync(async (req, res, next) => {
//   // Dev - This is only REMPORARY, because it's UNSECURE: everyone can make bookings without paying
//   const { tour, user, price, date } = req.query;

//   if (!tour && !user && !price & !date) return next();
//   await Booking.create({
//     tour,
//     user,
//     price,
//     startDate: date,
//     status: 'active'
//   });
//   const tourDoc = await Tour.findById(tour).lean();

//   const updatedTour = {
//     ...tourDoc,
//     startDates: tourDoc.startDates.map(d =>
//       dayjs(d.date).isSame(date)
//         ? {
//             date: d.date,
//             participants: d.participants + 1,
//             soldOut: d.participants + 1 === tourDoc.maxGroupSize ? true : false
//           }
//         : { ...d }
//     )
//   };

//   await Tour.findByIdAndUpdate(tour, updatedTour);

//   res.redirect('https://localhost:4202/profile/bookings');
// });

const createBookingCheckout = async session => {
  const { tourId, userId, date } = JSON.parse(session.client_reference_id);

  // const tour = session.client_reference_id;
  // const user = (await User.findOne({ email: session.customer_email })).id;
  const price = session.amount_total / 100;

  await Booking.create({
    tour: tourId,
    user: userId,
    price,
    startDate: date,
    status: 'active',
    paid: true,
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent
  });

  const tourDoc = await Tour.findById(tourId).lean();

  const updatedTour = {
    ...tourDoc,
    startDates: tourDoc.startDates.map(d =>
      dayjs(d.date).isSame(date)
        ? {
            date: d.date,
            participants: d.participants + 1,
            soldOut: d.participants + 1 === tourDoc.maxGroupSize ? true : false
          }
        : { ...d }
    )
  };

  await Tour.findByIdAndUpdate(tourId, updatedTour);
};

exports.webhookCheckout = (req, res, next) => {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed')
    createBookingCheckout(event.data.object);

  if (event.type === 'charge.refunded') refundBooking(event.data.object);

  if (event.type === 'charge.refund.updated') cancelRefund(event.data.object);

  res.status(200).json({ received: true });
};

const refundBooking = async charge => {
  const booking = await Booking.findOne({
    stripePaymentIntentId: charge.payment_intent
  });

  if (!booking) return;

  const refundData = await stripe.refunds.list({
    payment_intent: charge.payment_intent,
    limit: 1
  });
  const latestRefund = refundData.data[0];

  const alreadyRefunded = booking.refunds.some(
    r => r.stripeRefundId === latestRefund.id
  );
  if (alreadyRefunded) return;

  // const totalRefunded = booking.refunds.reduce((sum, r) => sum + r.amount, 0) + latestRefund.amount / 100;
  // const isPartialRefund = charge.amount_refunded / 100 < booking.price;
  const isFullRefund = charge.amount_refunded === charge.amount;
  const newStatus =
    booking.status === 'cancelled'
      ? isFullRefund
        ? 'refunded'
        : 'cancelled'
      : isFullRefund
      ? 'refunded'
      : 'partial_refund';

  const updatedBooking = await Booking.findOneAndUpdate(
    { _id: booking._id },
    {
      status: newStatus,
      paid: !isFullRefund,
      $push: {
        refunds: {
          $each: [
            {
              stripeRefundId: latestRefund.id,
              refundedAt: new Date(),
              amount: latestRefund.amount / 100,
              reason: latestRefund ? latestRefund.reason : null
            }
          ],
          $sort: { refundedAt: -1 }
        }
      }
    },
    { new: true }
  );

  if (isFullRefund && booking.status !== 'cancelled') {
    await Tour.updateOne(
      { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
      { $inc: { 'startDates.$.participants': -1 } }
    );

    await Tour.updateOne(
      { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
      { $set: { 'startDates.$.soldOut': false } }
    );
  }
};

const cancelRefund = async refund => {
  if (refund.status !== 'canceled') return;

  const booking = await Booking.findOneAndUpdate(
    { stripePaymentIntentId: refund.payment_intent },
    {
      $pull: { refunds: { stripeRefundId: refund.id } }
    },
    { new: true }
  );

  if (!booking) return;

  const totalRefunded = booking.refunds.reduce((sum, r) => sum + r.amount, 0);
  const isPartialRefund = totalRefunded > 0 && totalRefunded < booking.price;
  const isFullyRefunded = totalRefunded >= booking.price;

  const updatedBooking = await Booking.findByIdAndUpdate(
    booking._id,
    {
      status: isFullyRefunded
        ? 'refunded'
        : isPartialRefund
        ? 'partial_refund'
        : 'active',
      paid: totalRefunded === 0 ? true : isPartialRefund
    },
    { new: true }
  );

  if (
    booking.status === 'refunded' &&
    (updatedBooking.status === 'active' ||
      updatedBooking.status === 'partial_refund')
  ) {
    await Tour.updateOne(
      { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
      { $inc: { 'startDates.$.participants': 1 } }
    );

    const tour = await Tour.findById(booking.tour);
    const startDate = tour.startDates.find(
      d => d.date.toISOString() === new Date(booking.startDate).toISOString()
    );
    if (startDate && startDate.participants >= tour.maxGroupSize) {
      await Tour.updateOne(
        { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
        { $set: { 'startDates.$.soldOut': true } }
      );
    }
  }
};

exports.refundPayment = catchAsync(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new AppError('No document found with that ID', 404));
  }

  if (!booking.stripePaymentIntentId) {
    return next(new AppError('No payment found for this booking', 400));
  }

  if (booking.status === 'refunded') {
    return next(new AppError('Booking already refunded', 400));
  }

  const stripeRefund = await stripe.refunds.create({
    payment_intent: booking.stripePaymentIntentId,
    amount: Math.round(req.body.amount * 100),
    reason: req.body.reason,
    metadata: {
      note: req.body.note,
      agent: req.user.email
    }
  });

  const totalRefunded =
    booking.refunds.reduce((sum, r) => sum + r.amount, 0) + req.body.amount;

  const isPartialRefund = totalRefunded < booking.price;
  const newStatus =
    booking.status === 'cancelled'
      ? isPartialRefund
        ? 'cancelled'
        : 'refunded'
      : isPartialRefund
      ? 'partial_refund'
      : 'refunded';

  const doc = await Booking.findByIdAndUpdate(
    req.params.id,
    {
      status: newStatus,
      paid: isPartialRefund,
      $push: {
        refunds: {
          $each: [
            {
              stripeRefundId: stripeRefund.id,
              refundedAt: new Date(),
              refundedBy: req.user.id,
              amount: req.body.amount,
              reason: req.body.reason,
              note: req.body.note
            }
          ],
          $sort: { refundedAt: -1 }
        }
      }
    },
    { new: true }
  )
    .populate('tour')
    .populate('refunds.refundedBy', 'name email');

  if (!isPartialRefund && booking.status !== 'cancelled') {
    await Tour.updateOne(
      { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
      { $inc: { 'startDates.$.participants': -1 } }
    );

    await Tour.updateOne(
      { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
      { $set: { 'startDates.$.soldOut': false } }
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      data: doc
    }
  });
});

exports.getMyBooking = catchAsync(async (req, res, next) => {
  const bookings = await Booking.find({ user: req.user.id }).sort({
    createdAt: -1
  });

  if (!bookings) {
    return next(new AppError('No document found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    results: bookings.length,
    data: {
      data: bookings
    }
  });
});

exports.createBooking = factory.createOne(Booking);
exports.getBooking = factory.getOne(Booking);
//exports.getAllBookings = factory.getAll(Booking, { path: 'bookings' });
exports.getAllBookings = catchAsync(async (req, res, next) => {
  const bookings = await Booking.find()
    .setOptions({ skipPopulate: true })
    .lean()
    .select('reservationNumber createdAt paid status price')
    .populate({
      path: 'user',
      select: 'name'
    })
    .populate({
      path: 'tour',
      select: 'name',
      options: { skipPopulate: true }
    });

  res.status(200).json({
    status: 'success',
    results: bookings.length,
    data: { data: bookings }
  });
});
exports.updateBooking = catchAsync(async (req, res, next) => {
  const oldBooking = await Booking.findById(req.params.id);

  if (!oldBooking) {
    return next(new AppError('No document found with that ID', 404));
  }

  if (
    req.body.startDate &&
    oldBooking.status !== 'active' &&
    oldBooking.status !== 'partial_refund'
  ) {
    return next(
      new AppError('Cannot change date of cancelled or refunded booking', 400)
    );
  }

  if (
    (req.body.paid !== undefined &&
      req.body.paid !== oldBooking.paid &&
      oldBooking.status === 'refunded') ||
    oldBooking.status === 'partial_refund'
  ) {
    return next(
      new AppError(
        'Cannot change payment status of refunded or partial refund booking',
        400
      )
    );
  }

  if (
    req.body.startDate &&
    req.body.startDate !== oldBooking.startDate.toISOString()
  ) {
    await Tour.updateOne(
      {
        _id: oldBooking.tour,
        'startDates.date': new Date(oldBooking.startDate)
      },
      { $inc: { 'startDates.$.participants': -1 } }
    );

    await Tour.updateOne(
      {
        _id: oldBooking.tour,
        'startDates.date': new Date(oldBooking.startDate)
      },
      { $set: { 'startDates.$.soldOut': false } }
    );

    await Tour.updateOne(
      { _id: oldBooking.tour, 'startDates.date': new Date(req.body.startDate) },
      { $inc: { 'startDates.$.participants': 1 } }
    );

    const tour = await Tour.findById(oldBooking.tour);
    const newStartDate = tour.startDates.find(
      d => d.date.toISOString() === new Date(req.body.startDate).toISOString()
    );

    if (newStartDate && newStartDate.participants >= tour.maxGroupSize) {
      await Tour.updateOne(
        {
          _id: oldBooking.tour,
          'startDates.date': new Date(req.body.startDate)
        },
        { $set: { 'startDates.$.soldOut': true } }
      );
    }
  }

  const doc = await Booking.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  }).populate('tour');

  res.status(200).json({
    status: 'success',
    data: {
      data: doc
    }
  });
});

exports.cancelBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new AppError('No document found with that ID', 404));
  }

  if (booking.status !== 'active' && booking.status !== 'partial_refund') {
    return next(
      new AppError(
        'Only active and partial refund bookings can be cancelled',
        400
      )
    );
  }

  if (
    req.user.role !== 'admin' &&
    req.user._id.toString() !== booking.user._id.toString()
  ) {
    return next(
      new AppError('You do not have permission to cancel this booking', 403)
    );
  }

  const tourStartDate = new Date(booking.startDate);
  const now = new Date();
  const daysUntilStart = (tourStartDate - now) / (1000 * 60 * 60 * 24);

  if (req.user.role !== 'admin' && daysUntilStart < 7) {
    return next(
      new AppError(
        'Bookings can only be cancelled at least 7 days before the tour start date',
        400
      )
    );
  }

  if (!req.body.reason) {
    return next(new AppError('Cancellation reason is required', 400));
  }

  const doc = await Booking.findByIdAndUpdate(
    req.params.id,
    {
      status: 'cancelled',
      cancellation: {
        cancelledAt: new Date(),
        cancelledBy: req.user.id,
        reason: req.body.reason,
        note: req.body.note
      }
    },
    {
      new: true,
      runValidators: true
    }
  )
    .populate('tour')
    .populate('cancellation.cancelledBy', 'name email');

  await Tour.updateOne(
    {
      _id: booking.tour,
      'startDates.date': new Date(booking.startDate)
    },
    { $inc: { 'startDates.$.participants': -1 } }
  );

  await Tour.updateOne(
    {
      _id: booking.tour,
      'startDates.date': new Date(booking.startDate)
    },
    { $set: { 'startDates.$.soldOut': false } }
  );

  res.status(200).json({
    status: 'success',
    data: {
      data: doc
    }
  });
});

exports.deleteBooking = catchAsync(async (req, res, next) => {
  const booking = await Booking.findById(req.params.id);

  if (!booking) {
    return next(new AppError('No document found with that ID', 404));
  }

  if (booking.status === 'active' || booking.status === 'partial_refund') {
    await Tour.updateOne(
      { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
      { $inc: { 'startDates.$.participants': -1 } }
    );

    await Tour.updateOne(
      { _id: booking.tour, 'startDates.date': new Date(booking.startDate) },
      { $set: { 'startDates.$.soldOut': false } }
    );
  }

  await Booking.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null
  });
});

exports.getTourBookingInfo = catchAsync(async (req, res, next) => {
  const tour = await Tour.findById(req.params.tourId);

  if (!tour) {
    return next(new AppError('No document found with that ID', 404));
  }

  const [booking, review] = await Promise.all([
    Booking.findOne({
      user: req.user.id,
      tour: req.params.tourId,
      status: { $in: ['active', 'partial_refund'] }
    }).select('startDate'),
    Review.findOne({ user: req.user.id, tour: req.params.tourId })
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      data: {
        startDate: booking ? booking.startDate : null,
        review: review ? review : null
      }
    }
  });
});
