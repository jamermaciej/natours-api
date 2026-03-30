const mongoose = require('mongoose');
const Counter = require('./counter');

const bookingSchema = new mongoose.Schema({
  tour: {
    type: mongoose.Schema.ObjectId,
    ref: 'Tour',
    required: [true, 'Booking must belong to a Tour!']
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Booking must belong to a User!']
  },
  price: {
    type: Number,
    require: [true, 'Booking must have a price.']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  paid: {
    type: Boolean,
    default: true
  },
  reservationNumber: {
    type: String,
    unique: true,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'cancelled', 'refunded'],
    default: 'pending'
  },
  stripePaymentIntentId: {
    type: String
  },
  stripeSessionId: {
    type: String
  },
  cancellation: {
    cancelledAt: Date,
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String
  },
  refund: {
    refundedAt: Date,
    refundedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    amount: Number,
    reason: String,
    note: String
  }
});

bookingSchema.pre(/^find/, function(next) {
  this.populate('user')
    .populate({
      path: 'tour',
      select: 'name slug startDates maxGroupSize'
    })
    .populate({
      path: 'cancellation.cancelledBy',
      select: 'name email'
    })
    .populate({
      path: 'refund.refundedBy',
      select: 'name email'
    });
  next();
});

bookingSchema.pre('validate', async function(next) {
  if (!this.reservationNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    const counterId = `reservation-${year}${month}`;

    const counter = await Counter.findByIdAndUpdate(
      counterId,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const sequence = String(counter.seq).padStart(4, '0');
    this.reservationNumber = `${year}${month}-${sequence}`;
  }
  next();
});

bookingSchema.index({ reservationNumber: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
