const mongoose = require('mongoose');

const BookingResponseSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    required: true,
  },
  customerName: {
    type: String,
    default: '',
  },
  // Punch-in (Pre-ride checklist)
  carCleaned: {
    type: String,
    default: '',
  },
  phoneCharged: {
    type: String,
    default: '',
  },
  enoughPetrol: {
    type: String,
    default: '',
  },
  // Punch-out (Ride completion report)
  status: {
    type: String,
    default: '',
  },
  guestDetails: {
    type: String,
    default: '',
  },
  luggageDetails: {
    type: String,
    default: '',
  },
  operationalIssues: {
    type: String,
    default: '',
  },
  checkboxAnswers: {
    type: String,
    default: '',
  },
  issueDescription: {
    type: String,
    default: '',
  },
  guestFeedbackOptions: {
    type: String,
    default: '',
  },
  guestFeedbackText: {
    type: String,
    default: '',
  },
  remarks: {
    type: String,
    default: '',
  }
});

const ShiftSchema = new mongoose.Schema(
  {
    chauffeur: {
      name: {
        type: String,
        required: true,
      },
      number: {
        type: String,
        required: true,
      }
    },
    logInTime: {
      type: String,
      default: '',
    },
    logOutTime: {
      type: String,
      default: '',
    },
    vrClean: {
      type: String,
      default: '',
    },
    vrAmenities: {
      type: String,
      default: '',
    },
    vrReady: {
      type: String,
      default: '',
    },
    readinessImageLink: {
      type: String,
      default: '',
    },
    endShiftImageLink: {
      type: String,
      default: '',
    },
    bookings: [BookingResponseSchema],
    dateStr: {
      type: String,
      required: true,
    }
  },
  {
    timestamps: true,
    collection: 'shifts',
  }
);

// Indexing for efficient daily grouping and chauffeur search
ShiftSchema.index({ dateStr: 1, 'chauffeur.number': 1 });

module.exports = mongoose.model('Shift', ShiftSchema);
