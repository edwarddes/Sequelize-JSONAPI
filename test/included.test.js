'use strict';

const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const jsonapi = require('../index');
const {
	User,
	Post,
	Comment,
	initDatabase,
	resetDatabase,
	closeDatabase,
	seedTestData
} = require('./helpers/setup');

describe('Included Resources (Compound Documents)', function() {
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
		jsonapi.createRoutesForModel(router, Comment);

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

	describe('GetSingle with included', function() {
		it('should include related posts in compound document when fetching user', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.have.property('relationships');

			// Should have included member with related posts
			expect(response.body).to.have.property('included');
			expect(response.body.included).to.be.an('array');
			expect(response.body.included.length).to.be.greaterThan(0);

			// Each included resource should have type, id, and attributes
			response.body.included.forEach((resource) => {
				expect(resource).to.have.property('type');
				expect(resource).to.have.property('id');
				expect(resource.id).to.be.a('string'); // IDs should be strings
				expect(resource).to.have.property('attributes');
			});
		});

		it('should include all posts belonging to user in included array', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			// Check that included contains Post resources
			const includedPosts = response.body.included.filter(r => r.type === 'Post');
			expect(includedPosts.length).to.equal(2); // user1 has 2 posts
		});

		it('should include all comments belonging to post in included array', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/posts/${post1.id}`)
				.expect(200);

			// Check that included contains Comment resources
			expect(response.body).to.have.property('included');
			const includedComments = response.body.included.filter(r => r.type === 'Comment');
			expect(includedComments.length).to.equal(2); // post1 has 2 comments
		});

		it('should omit included member when simple=true query parameter is set', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.query({ simple: true })
				.expect(200);

			// With simple=true, should not have included
			expect(response.body).to.not.have.property('included');
			expect(response.body.data).to.not.have.property('relationships');
		});

		it('should omit included member when resource has no related resources', async function() {
			// Create a user with no posts
			const user = await User.create({
				name: 'Lonely User',
				email: 'lonely@example.com',
				age: 25
			});

			const response = await request(app)
				.get(`/api/users/${user.id}`)
				.expect(200);

			// Should not have included member if there are no related resources
			expect(response.body).to.not.have.property('included');
		});
	});

	describe('GetList with included', function() {
		it('should include related resources when filtering by id', async function() {
			const { user1, user2 } = await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: { id: `${user1.id},${user2.id}` } })
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.be.an('array');

			// Should have included member with all related posts
			expect(response.body).to.have.property('included');
			expect(response.body.included).to.be.an('array');
			expect(response.body.included.length).to.be.greaterThan(0);

			// All included resources should have proper structure
			response.body.included.forEach((resource) => {
				expect(resource).to.have.property('type');
				expect(resource).to.have.property('id');
				expect(resource.id).to.be.a('string');
				expect(resource).to.have.property('attributes');
			});
		});

		it('should deduplicate included resources', async function() {
			// If two users share a post (through comments on the same post),
			// that post should only appear once in included

			const { user1 } = await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: { id: user1.id.toString() } })
				.expect(200);

			// Count unique included resources by type:id
			const seen = new Set();
			response.body.included.forEach((resource) => {
				const key = `${resource.type}:${resource.id}`;
				expect(seen.has(key)).to.be.false; // Should not have duplicates
				seen.add(key);
			});
		});

		it('should not include member for simple list (no filter)', async function() {
			await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.expect(200);

			// Without filter/idList, should not have included (simple mode)
			expect(response.body).to.not.have.property('included');
		});
	});

	describe('Update with included', function() {
		it('should include related resources in update response', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/posts/${post1.id}`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							title: 'Updated Title'
						}
					}
				})
				.expect(200);

			expect(response.body).to.have.property('data');

			// Should include related comments
			expect(response.body).to.have.property('included');
			const includedComments = response.body.included.filter(r => r.type === 'Comment');
			expect(includedComments.length).to.equal(2);
		});
	});
});
