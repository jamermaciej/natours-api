class APIFeatures {
  constructor(query, queryString, paths, Model) {
    this.query = query;
    this.queryString = queryString;
    this.paths = paths;
    this.model = Model;
  }

  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'sort', 'limit', 'fields', 'q'];
    excludedFields.forEach(el => delete queryObj[el]);

    // 1B) Advanced filtering
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, match => `$${match}`);

    this.query = this.query.find(JSON.parse(queryStr));

    this.total = this.model.countDocuments({
      ...queryObj
    });

    return this;
  }

  search() {
    const term = this.queryString['q'];

    if (!term) return this;

    const regex = new RegExp(term, 'i');

    let fieldsToSearch = Object.keys(this.paths).filter(
      key => this.paths[key].instance === 'String'
    );

    const excludedFields = [
      'photo',
      'password',
      'passwordConfirm',
      'passwordResetToken',
      'token'
    ];
    fieldsToSearch = fieldsToSearch.filter(el => !excludedFields.includes(el));

    const orConditions = fieldsToSearch.map(field => ({ [field]: regex }));

    this.query = this.query.find({ $or: orConditions });
    // this.query = this.query.find({ $text: { $search: term } });
    // this.query = this.query.find({ name: regex });

    this.total = this.model.countDocuments({
      $or: orConditions
    });

    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }

    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select('-__v');
    }

    return this;
  }

  paginate() {
    const page = this.queryString.page * 1 || 1;
    const limit = this.queryString.limit * 1 || 100;
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);

    return this;
  }
}
module.exports = APIFeatures;
