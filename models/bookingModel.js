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
    default: Date.now()
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
  }
});

bookingSchema.pre(/^find/, function(next) {
  this.populate('user').populate({
    path: 'tour',
    select: 'name slug startDates maxGroupSize'
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
