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

describe('Relationship Endpoints', function() {
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

	describe('GET /relationships/:relationship', function() {
		it('should fetch relationship data for hasMany association', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}/relationships/posts`)
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(2);

			// Verify resource identifiers
			response.body.data.forEach((identifier) => {
				expect(identifier).to.have.property('type', 'Post');
				expect(identifier).to.have.property('id');
				expect(identifier.id).to.be.a('string');
				// Should not have attributes (just identifiers)
				expect(identifier).to.not.have.property('attributes');
			});

			// Verify links
			expect(response.body).to.have.property('links');
			expect(response.body.links).to.have.property('self');
			expect(response.body.links).to.have.property('related');
			expect(response.body.links.self).to.include('/relationships/posts');
			expect(response.body.links.related).to.include('/posts');
		});

		it('should fetch relationship data for belongsTo association', async function() {
			const { post1, user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/posts/${post1.id}/relationships/userId`)
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.be.an('object');
			expect(response.body.data).to.have.property('type', 'User');
			expect(response.body.data).to.have.property('id', String(user1.id));
			expect(response.body.data).to.not.have.property('attributes');

			// Verify links
			expect(response.body).to.have.property('links');
			expect(response.body.links).to.have.property('self');
			expect(response.body.links).to.have.property('related');
		});

		it('should fetch relationship data for hasOne association', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}/relationships/profileId`)
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.be.an('object');
			expect(response.body.data).to.have.property('type', 'Profile');
			expect(response.body.data).to.have.property('id');
			expect(response.body.data).to.not.have.property('attributes');
		});

		it('should return null for belongsTo with no related resource', async function() {
			const post = await Post.create({
				title: 'Orphan Post',
				content: 'No user'
			});

			const response = await request(app)
				.get(`/api/posts/${post.id}/relationships/userId`)
				.expect(200);

			expect(response.body.data).to.be.null;
		});

		it('should return empty array for hasMany with no related resources', async function() {
			const user = await User.create({
				name: 'Lonely User',
				email: 'lonely@example.com',
				age: 25
			});

			const response = await request(app)
				.get(`/api/users/${user.id}/relationships/posts`)
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(0);
		});

		it('should return 404 for non-existent parent resource', async function() {
			await request(app)
				.get('/api/users/9999/relationships/posts')
				.expect(404);
		});

		it('should return 404 for invalid relationship name', async function() {
			const { user1 } = await seedTestData();

			await request(app)
				.get(`/api/users/${user1.id}/relationships/invalidRelationship`)
				.expect(404);
		});
	});

	describe('PATCH /relationships/:relationship', function() {
		it('should update hasMany relationship (full replacement)', async function() {
			const { user1, user2 } = await seedTestData();

			// Get user1's current posts
			const currentPosts = await Post.findAll({
				where: { userId: user1.id }
			});
			expect(currentPosts).to.have.lengthOf(2);

			// Get user2's posts
			const user2Posts = await Post.findAll({
				where: { userId: user2.id }
			});
			const user2PostCount = user2Posts.length;

			// Replace user1's posts with user2's posts
			const response = await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: user2Posts.map(post => ({
						type: 'Post',
						id: String(post.id)
					}))
				})
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(user2PostCount);

			// Verify the posts now belong to user1
			const updatedPosts = await Post.findAll({
				where: { userId: user1.id }
			});
			expect(updatedPosts).to.have.lengthOf(user2PostCount);

			// Verify user2 now has no posts
			const user2UpdatedPosts = await Post.findAll({
				where: { userId: user2.id }
			});
			expect(user2UpdatedPosts).to.have.lengthOf(0);
		});

		it('should update belongsTo relationship', async function() {
			const { post1, user1, user2 } = await seedTestData();

			// Verify post1 belongs to user1
			expect(post1.userId).to.equal(user1.id);

			// Update to belong to user2
			const response = await request(app)
				.patch(`/api/posts/${post1.id}/relationships/userId`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						type: 'User',
						id: String(user2.id)
					}
				})
				.expect(200);

			expect(response.body.data).to.be.an('object');
			expect(response.body.data).to.have.property('id', String(user2.id));

			// Verify in database
			await post1.reload();
			expect(post1.userId).to.equal(user2.id);
		});

		it('should set belongsTo relationship to null', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/posts/${post1.id}/relationships/userId`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: null
				})
				.expect(200);

			expect(response.body.data).to.be.null;

			// Verify in database
			await post1.reload();
			expect(post1.userId).to.be.null;
		});

		it('should clear hasMany relationship with empty array', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: []
				})
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(0);

			// Verify in database
			const posts = await Post.findAll({
				where: { userId: user1.id }
			});
			expect(posts).to.have.lengthOf(0);
		});

		it('should return 400 for missing data member', async function() {
			const { user1 } = await seedTestData();

			await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({})
				.expect(400);
		});

		it('should return 400 for invalid data type on hasMany (not array)', async function() {
			const { user1 } = await seedTestData();

			await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: { type: 'Post', id: '1' }
				})
				.expect(400);
		});

		it('should return 400 for invalid data type on belongsTo (array instead of object)', async function() {
			const { post1, user1 } = await seedTestData();

			await request(app)
				.patch(`/api/posts/${post1.id}/relationships/userId`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: [{ type: 'User', id: String(user1.id) }]
				})
				.expect(400);
		});

		it('should return 404 for non-existent parent resource', async function() {
			await request(app)
				.patch('/api/users/9999/relationships/posts')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: []
				})
				.expect(404);
		});

		it('should return 404 for invalid relationship name', async function() {
			const { user1 } = await seedTestData();

			await request(app)
				.patch(`/api/users/${user1.id}/relationships/invalidRelationship`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: []
				})
				.expect(404);
		});
	});

	describe('Relationship endpoint integration', function() {
		it('should maintain consistency between relationship endpoint and resource', async function() {
			const { user1 } = await seedTestData();

			// Get the full resource
			const resourceResponse = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			// Get the relationship data
			const relationshipResponse = await request(app)
				.get(`/api/users/${user1.id}/relationships/posts`)
				.expect(200);

			// The data should match
			expect(resourceResponse.body.data.relationships.posts.data).to.deep.equal(
				relationshipResponse.body.data
			);
		});

		it('should update relationship via endpoint and reflect in resource', async function() {
			const { post1, user2 } = await seedTestData();

			// Update relationship
			await request(app)
				.patch(`/api/posts/${post1.id}/relationships/userId`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						type: 'User',
						id: String(user2.id)
					}
				})
				.expect(200);

			// Fetch the full resource
			const resourceResponse = await request(app)
				.get(`/api/posts/${post1.id}`)
				.expect(200);

			// Verify the relationship is updated
			expect(resourceResponse.body.data.relationships.userId.data).to.deep.equal({
				type: 'User',
				id: String(user2.id)
			});
		});
	});
});
