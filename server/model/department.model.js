const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    // Which screens membership of this department grants. Empty by default:
    // a department grants nothing until an admin ticks a box.
    modules: [{ type: String, enum: ['sales', 'leads'] }],
},
{
    timestamps: true
});

const Department = mongoose.model("Department", departmentSchema);

module.exports = Department;
