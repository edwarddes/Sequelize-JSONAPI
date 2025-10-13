# Test Suite

This directory contains the comprehensive test suite for Sequelize-JSONAPI.

## Structure

```
test/
├── README.md           # This file
├── helpers/
│   └── setup.js       # Test database setup and models
└── jsonapi.test.js    # Main test suite
```

## Running Tests

Install test dependencies first:

```bash
npm install
```

Run all tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Test Coverage

The test suite covers:

### 1. Create Operation
- Creating new resources
- Creating resources with belongsTo relationships
- Creating resources with null relationships
- Handling missing relationships object

### 2. GetSingle Operation
- Fetching a single resource
- Fetching with simple mode (no relationships)
- Fetching with relationships (hasMany, hasOne, belongsTo)
- 404 for non-existent resources

### 3. GetList Operation
- Fetching all resources
- Empty array when no resources exist
- Filtering by ID list (comma-separated)
- Filtering by single ID
- Filtering by custom parameters

### 4. Update Operation
- Updating resource attributes
- Converting empty strings to null for integer columns
- Updating belongsTo relationships
- Setting relationships to null
- 404 for non-existent resources
- Returning updated resource with relationships

### 5. Delete Operation
- Deleting resources
- 204 status with no content
- 404 for non-existent resources

### 6. Relationship Handling
- HasMany associations
- HasOne associations
- BelongsTo associations
- Resources with no associations

### 7. Route Generation
- Dasherized plural model names (UserProfile → /user-profiles)

### 8. Edge Cases
- Resources with no associations
- Empty filter objects
- ID exclusion from attributes
- Association key exclusion from attributes

## Test Models

The test suite uses an in-memory SQLite database with the following models:

- **User**: Has many Posts, has one Profile
- **Post**: Belongs to User, has many Comments
- **Comment**: Belongs to Post
- **Profile**: Belongs to User

## Test Data

Test data is seeded before each test using the `seedTestData()` function:

- 2 Users (John Doe, Jane Smith)
- 3 Posts (2 by John, 1 by Jane)
- 2 Comments on first post
- 1 Profile for John

## Technologies

- **Mocha**: Test framework
- **Chai**: Assertion library
- **Supertest**: HTTP assertion library
- **Express**: Web framework for route testing
- **Sequelize**: ORM with SQLite in-memory database
- **Sinon**: Test spies, stubs, and mocks (available if needed)
