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
		it('should replace all related resources when updating hasMany relationship', async function() {
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

		it('should change parent resource when updating belongsTo relationship', async function() {
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

		it('should remove parent resource when setting belongsTo relationship to null', async function() {
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

		it('should remove all related resources when clearing hasMany relationship with empty array', async function() {
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

		it('should return 400 when sending object instead of array for hasMany relationship', async function() {
			const { user1 } = await seedTestData();

			await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: { type: 'Post', id: '1' }
				})
				.expect(400);
		});

		it('should return 400 when sending array instead of object for belongsTo relationship', async function() {
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

		it('should handle updating hasMany relationship with non-existent resource IDs', async function() {
			const { user1 } = await seedTestData();

			// Try to set relationship to non-existent post IDs
			const response = await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: [
						{ type: 'Post', id: '99999' },
						{ type: 'Post', id: '99998' }
					]
				})
				.expect(200);

			// The update should succeed but with no actual relationships created
			// since the IDs don't exist
			const posts = await Post.findAll({
				where: { userId: user1.id }
			});
			expect(posts).to.have.lengthOf(0);
		});

		it('should handle updating belongsTo relationship with non-existent resource ID', async function() {
			const { post1 } = await seedTestData();

			// Try to set relationship to non-existent user ID
			// This will fail with a 500 error if foreign key constraints are enabled
			// Or succeed if they're not enabled (depends on DB configuration)
			const response = await request(app)
				.patch(`/api/posts/${post1.id}/relationships/userId`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						type: 'User',
						id: '99999'
					}
				});

			// Accept either 200 (no FK constraints) or 500 (FK constraint violation)
			expect([200, 500]).to.include(response.status);
		});

		it('should handle empty resource identifier objects in hasMany update', async function() {
			const { user1 } = await seedTestData();

			// Send data with resource identifiers that have IDs
			const response = await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: [
						{ type: 'Post', id: '' }
					]
				})
				.expect(200);

			// Empty ID should be treated as falsy
			const posts = await Post.findAll({
				where: { userId: user1.id }
			});
			expect(posts).to.have.lengthOf(0);
		});

		it('should handle large batch updates for hasMany relationships', async function() {
			const { user1 } = await seedTestData();

			// Create 50 posts belonging to no one
			const postPromises = [];
			for (let i = 0; i < 50; i++) {
				postPromises.push(Post.create({
					title: `Batch Post ${i}`,
					content: `Content ${i}`
				}));
			}
			const posts = await Promise.all(postPromises);

			// Update user1's posts to include all 50 posts
			const response = await request(app)
				.patch(`/api/users/${user1.id}/relationships/posts`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: posts.map(post => ({
						type: 'Post',
						id: String(post.id)
					}))
				})
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(50);

			// Verify in database
			const updatedPosts = await Post.findAll({
				where: { userId: user1.id }
			});
			expect(updatedPosts).to.have.lengthOf(50);
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
