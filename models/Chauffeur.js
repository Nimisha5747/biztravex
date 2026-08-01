const mongoose = require('mongoose');

const ChauffeurSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Chauffeur name is required'],
      trim: true,
    },
    number: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'chauffeurs', // Saved inside 'chauffeur' database
  }
);

// Compound index to ensure uniqueness of name + number combination
ChauffeurSchema.index({ number: 1 }, { unique: true });

module.exports = mongoose.model('Chauffeur', ChauffeurSchema);
