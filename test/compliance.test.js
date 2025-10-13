'use strict';

const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const jsonapi = require('../index');
const {
	User,
	Post,
	initDatabase,
	resetDatabase,
	closeDatabase,
	seedTestData
} = require('./helpers/setup');

describe('JSON:API Compliance', function() {
	let app;
	let server;

	before(async function() {
		await initDatabase();
	});

	beforeEach(async function() {
		await resetDatabase();

		app = express();
		app.use(express.json({ type: 'application/vnd.api+json' }));

		const router = express.Router();
		jsonapi.createRoutesForModel(router, User);
		jsonapi.createRoutesForModel(router, Post);

		app.use('/api', router);
		server = app.listen(0);
	});

	afterEach(function(done) {
		if (server) {
			server.close(done);
		} else {
			done();
		}
	});

	after(async function() {
		await closeDatabase();
	});

	describe('Content-Type Headers', function() {
		it('should return application/vnd.api+json Content-Type for GET', async function() {
			await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.expect(200)
				.expect('Content-Type', /application\/vnd\.api\+json/);

			expect(response.headers['content-type']).to.include('application/vnd.api+json');
		});

		it('should return application/vnd.api+json Content-Type for POST', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							name: 'Test',
							email: 'test@example.com'
						}
					}
				})
				.expect(201);

			expect(response.headers['content-type']).to.include('application/vnd.api+json');
		});

		it('should return application/vnd.api+json Content-Type for PATCH', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/users/${user1.id}`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							name: 'Updated'
						}
					}
				})
				.expect(200);

			expect(response.headers['content-type']).to.include('application/vnd.api+json');
		});

		it('should return application/vnd.api+json Content-Type for DELETE', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.delete(`/api/users/${user1.id}`)
				.expect(204);

			expect(response.headers['content-type']).to.include('application/vnd.api+json');
		});
	});

	describe('Content-Type Validation', function() {
		it('should reject POST without Content-Type header', async function() {
			const response = await request(app)
				.post('/api/users')
				.send({
					data: {
						attributes: {
							name: 'Test',
							email: 'test@example.com'
						}
					}
				})
				.expect(400);

			expect(response.body).to.have.property('errors');
			expect(response.body.errors).to.be.an('array');
			expect(response.body.errors[0]).to.have.property('title', 'Missing Content-Type');
		});

		it('should reject POST with wrong Content-Type', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/json')
				.send({
					data: {
						attributes: {
							name: 'Test',
							email: 'test@example.com'
						}
					}
				})
				.expect(415);

			expect(response.body).to.have.property('errors');
			expect(response.body.errors[0]).to.have.property('title', 'Unsupported Media Type');
		});

		it('should reject POST with Content-Type parameters', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json; charset=utf-8')
				.send({
					data: {
						attributes: {
							name: 'Test',
							email: 'test@example.com'
						}
					}
				})
				.expect(415);

			expect(response.body).to.have.property('errors');
			expect(response.body.errors[0].detail).to.include('without media type parameters');
		});

		it('should accept GET without Content-Type header', async function() {
			await seedTestData();

			await request(app)
				.get('/api/users')
				.expect(200);
		});
	});

	describe('Error Formatting', function() {
		it('should format 404 errors correctly', async function() {
			const response = await request(app)
				.get('/api/users/9999')
				.expect(404);

			expect(response.body).to.have.property('errors');
			expect(response.body.errors).to.be.an('array');
			expect(response.body.errors[0]).to.have.property('status', '404');
			expect(response.body.errors[0]).to.have.property('title');
			expect(response.body.errors[0]).to.have.property('detail');
		});

		it('should format validation errors correctly', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							// Missing required 'name' and 'email'
						}
					}
				})
				.expect(422);

			expect(response.body).to.have.property('errors');
			expect(response.body.errors).to.be.an('array');
			expect(response.body.errors.length).to.be.greaterThan(0);
			expect(response.body.errors[0]).to.have.property('status', '422');
			expect(response.body.errors[0]).to.have.property('title', 'Validation Error');
		});

		it('should format invalid request body errors correctly', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					// Missing 'data' object
					attributes: {
						name: 'Test',
						email: 'test@example.com'
					}
				})
				.expect(400);

			expect(response.body).to.have.property('errors');
			expect(response.body.errors[0]).to.have.property('status', '400');
			expect(response.body.errors[0]).to.have.property('title', 'Invalid Request');
			expect(response.body.errors[0].source).to.have.property('pointer', '/data');
		});

		it('should include source pointer for attribute errors', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {}
				})
				.expect(400);

			expect(response.body.errors[0].source).to.have.property('pointer', '/data/attributes');
		});
	});

	describe('Document Structure', function() {
		it('should have top-level "data" member in successful responses', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							name: 'Test',
							email: 'test@example.com'
						}
					}
				})
				.expect(201);

			expect(response.body).to.have.property('data');
		});

		it('should have top-level "errors" member in error responses', async function() {
			const response = await request(app)
				.get('/api/users/9999')
				.expect(404);

			expect(response.body).to.have.property('errors');
			expect(response.body).to.not.have.property('data');
		});

		it('should not have both "data" and "errors" members', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							name: 'Test',
							email: 'test@example.com'
						}
					}
				})
				.expect(201);

			const hasData = response.body.hasOwnProperty('data');
			const hasErrors = response.body.hasOwnProperty('errors');

			// Can't have both
			expect(hasData && hasErrors).to.be.false;
		});
	});

	describe('Error Object Members', function() {
		it('should include status in error objects', async function() {
			const response = await request(app)
				.get('/api/users/9999')
				.expect(404);

			expect(response.body.errors[0]).to.have.property('status');
			expect(response.body.errors[0].status).to.be.a('string');
		});

		it('should include title in error objects', async function() {
			const response = await request(app)
				.get('/api/users/9999')
				.expect(404);

			expect(response.body.errors[0]).to.have.property('title');
			expect(response.body.errors[0].title).to.be.a('string');
		});

		it('should include detail in error objects', async function() {
			const response = await request(app)
				.get('/api/users/9999')
				.expect(404);

			expect(response.body.errors[0]).to.have.property('detail');
			expect(response.body.errors[0].detail).to.be.a('string');
		});
	});
});
