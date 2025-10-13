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

describe('Links Support (Top-Level and Relationship)', function() {
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

	describe('Top-Level Links', function() {
		it('should include top-level self link in GetSingle response', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			expect(response.body).to.have.property('links');
			expect(response.body.links).to.have.property('self');
			expect(response.body.links.self).to.include('/api/users/');
			expect(response.body.links.self).to.include(String(user1.id));
		});

		it('should include top-level self link in GetList response', async function() {
			await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.expect(200);

			expect(response.body).to.have.property('links');
			expect(response.body.links).to.have.property('self');
			expect(response.body.links.self).to.include('/api/users');
		});

		it('should include top-level self link with query parameters in filtered GetList', async function() {
			const { user1, user2 } = await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: { id: `${user1.id},${user2.id}` } })
				.expect(200);

			expect(response.body).to.have.property('links');
			expect(response.body.links).to.have.property('self');
			expect(response.body.links.self).to.include('/api/users');
			expect(response.body.links.self).to.include('filter');
		});

		it('should include top-level self link in Create response', async function() {
			const response = await request(app)
				.post('/api/users')
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							name: 'New User',
							email: 'new@example.com',
							age: 25
						}
					}
				})
				.expect(201);

			expect(response.body).to.have.property('links');
			expect(response.body.links).to.have.property('self');
			expect(response.body.links.self).to.include('/api/users/');
			expect(response.body.links.self).to.include(response.body.data.id);
		});

		it('should include top-level self link in Update response', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/users/${user1.id}`)
				.set('Content-Type', 'application/vnd.api+json')
				.send({
					data: {
						attributes: {
							name: 'Updated Name'
						}
					}
				})
				.expect(200);

			expect(response.body).to.have.property('links');
			expect(response.body.links).to.have.property('self');
			expect(response.body.links.self).to.include('/api/users/');
			expect(response.body.links.self).to.include(String(user1.id));
		});

		it('should not include top-level links when simple=true', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.query({ simple: true })
				.expect(200);

			expect(response.body).to.not.have.property('links');
		});
	});

	describe('Relationship Links', function() {
		it('should include relationship links for hasMany associations', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			expect(response.body.data).to.have.property('relationships');
			expect(response.body.data.relationships).to.have.property('posts');
			expect(response.body.data.relationships.posts).to.have.property('links');
			expect(response.body.data.relationships.posts.links).to.have.property('self');
			expect(response.body.data.relationships.posts.links).to.have.property('related');
			expect(response.body.data.relationships.posts.links.self).to.include('/relationships/posts');
			expect(response.body.data.relationships.posts.links.related).to.include('/posts');
		});

		it('should include relationship links for belongsTo associations', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/posts/${post1.id}`)
				.expect(200);

			expect(response.body.data).to.have.property('relationships');
			expect(response.body.data.relationships).to.have.property('userId');
			expect(response.body.data.relationships.userId).to.have.property('links');
			expect(response.body.data.relationships.userId.links).to.have.property('self');
			expect(response.body.data.relationships.userId.links).to.have.property('related');
		});

		it('should include relationship links for hasOne associations', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			expect(response.body.data).to.have.property('relationships');
			expect(response.body.data.relationships).to.have.property('profileId');
			expect(response.body.data.relationships.profileId).to.have.property('links');
			expect(response.body.data.relationships.profileId.links).to.have.property('self');
			expect(response.body.data.relationships.profileId.links).to.have.property('related');
		});

		it('should not include relationship links when simple=true', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.query({ simple: true })
				.expect(200);

			expect(response.body.data).to.not.have.property('relationships');
		});

		it('should include relationship links in filtered GetList responses', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: { id: user1.id.toString() } })
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data[0]).to.have.property('relationships');
			expect(response.body.data[0].relationships).to.have.property('posts');
			expect(response.body.data[0].relationships.posts).to.have.property('links');
		});

		it('should include relationship links in Update responses', async function() {
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

			expect(response.body.data).to.have.property('relationships');
			expect(response.body.data.relationships).to.have.property('comments');
			expect(response.body.data.relationships.comments).to.have.property('links');
			expect(response.body.data.relationships.comments.links).to.have.property('self');
			expect(response.body.data.relationships.comments.links).to.have.property('related');
		});
	});

	describe('Related Links Functionality', function() {
		it('should have valid relationship self link format', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const postsRelationship = response.body.data.relationships.posts;
			expect(postsRelationship.links.self).to.match(/\/users\/\d+\/relationships\/posts$/);
		});

		it('should have valid related link format', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const postsRelationship = response.body.data.relationships.posts;
			expect(postsRelationship.links.related).to.match(/\/users\/\d+\/posts$/);
		});

		it('should have consistent link structure across all relationship types', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const relationships = response.body.data.relationships;

			// Check all relationships have both self and related links
			Object.keys(relationships).forEach((relName) => {
				expect(relationships[relName]).to.have.property('links');
				expect(relationships[relName].links).to.have.property('self');
				expect(relationships[relName].links).to.have.property('related');

				// Verify links are strings and not empty
				expect(relationships[relName].links.self).to.be.a('string').and.not.be.empty;
				expect(relationships[relName].links.related).to.be.a('string').and.not.be.empty;
			});
		});

		it('should have links that include the resource ID', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const postsLinks = response.body.data.relationships.posts.links;

			// Both self and related should include the user ID
			expect(postsLinks.self).to.include(String(user1.id));
			expect(postsLinks.related).to.include(String(user1.id));
		});

		it('should have different self and related links', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const postsLinks = response.body.data.relationships.posts.links;

			// Self and related should be different
			expect(postsLinks.self).to.not.equal(postsLinks.related);

			// Self should contain 'relationships' in path
			expect(postsLinks.self).to.include('/relationships/');

			// Related should not contain 'relationships' in path (or at least not in the same way)
			expect(postsLinks.related).to.not.include('/relationships/posts');
		});

		it('should have protocol and host in links', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const postsLinks = response.body.data.relationships.posts.links;

			// Links should be absolute URLs with protocol and host
			expect(postsLinks.self).to.match(/^https?:\/\//);
			expect(postsLinks.related).to.match(/^https?:\/\//);
		});

		it('should be able to fetch related resources using the related link (hasMany)', async function() {
			const { user1 } = await seedTestData();

			// First get the user to obtain the related link
			const userResponse = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const relatedLink = userResponse.body.data.relationships.posts.links.related;

			// Extract the path from the absolute URL
			const url = new URL(relatedLink);
			const path = url.pathname;

			// Follow the related link - note: this endpoint doesn't exist yet in the library
			// This test will help identify that the library needs to implement these endpoints
			// For now, we're just verifying the link format is correct
			expect(path).to.equal(`/api/users/${user1.id}/posts`);
		});

		it('should be able to fetch related resource using the related link (belongsTo)', async function() {
			const { post1, user1 } = await seedTestData();

			// First get the post to obtain the related link
			const postResponse = await request(app)
				.get(`/api/posts/${post1.id}`)
				.expect(200);

			const relatedLink = postResponse.body.data.relationships.userId.links.related;

			// Extract the path from the absolute URL
			const url = new URL(relatedLink);
			const path = url.pathname;

			// Verify the link points to the correct user
			expect(path).to.equal(`/api/posts/${post1.id}/userId`);

			// Note: The actual endpoint doesn't exist, but we can verify the link format
			// In a full implementation, this would need custom routes for related resources
		});

		it('should be able to use relationship data to fetch related resources directly', async function() {
			const { user1 } = await seedTestData();

			// Get the user with relationships
			const userResponse = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			// Get the related post IDs from the relationship data
			const postIds = userResponse.body.data.relationships.posts.data.map(p => p.id);
			expect(postIds).to.have.lengthOf(2);

			// Verify we can fetch each post directly using its ID
			for (const postId of postIds) {
				const postResponse = await request(app)
					.get(`/api/posts/${postId}`)
					.expect(200);

				expect(postResponse.body.data).to.have.property('id', postId);
				expect(postResponse.body.data).to.have.property('type', 'Post');
			}
		});

		it('should be able to verify related resources exist using included data', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			// Verify included data matches relationship data
			const postRelationships = response.body.data.relationships.posts.data;
			const includedPosts = response.body.included.filter(r => r.type === 'Post');

			expect(includedPosts).to.have.lengthOf(postRelationships.length);

			// Verify each relationship has corresponding included resource
			postRelationships.forEach((rel) => {
				const includedPost = includedPosts.find(p => p.id === rel.id);
				expect(includedPost).to.exist;
				expect(includedPost.type).to.equal('Post');
			});
		});
	});

	describe('Related Resource Endpoints', function() {
		it('should fetch related resources via hasMany relationship endpoint', async function() {
			const { user1 } = await seedTestData();

			// Fetch the user's posts via the related resource endpoint
			const response = await request(app)
				.get(`/api/users/${user1.id}/posts`)
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(2);

			// Verify each post has proper structure
			response.body.data.forEach((post) => {
				expect(post).to.have.property('type', 'Post');
				expect(post).to.have.property('id');
				expect(post).to.have.property('attributes');
				expect(post.attributes).to.have.property('title');
			});

			// Verify self link
			expect(response.body).to.have.property('links');
			expect(response.body.links.self).to.include(`/api/users/${user1.id}/posts`);
		});

		it('should fetch related resource via belongsTo relationship endpoint', async function() {
			const { post1, user1 } = await seedTestData();

			// Fetch the post's user via the related resource endpoint
			const response = await request(app)
				.get(`/api/posts/${post1.id}/userId`)
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.be.an('object');
			expect(response.body.data).to.have.property('type', 'User');
			expect(response.body.data).to.have.property('id', String(user1.id));
			expect(response.body.data).to.have.property('attributes');
			expect(response.body.data.attributes).to.have.property('name', 'John Doe');

			// Verify self link
			expect(response.body).to.have.property('links');
			expect(response.body.links.self).to.include(`/api/posts/${post1.id}/userId`);
		});

		it('should fetch related resource via hasOne relationship endpoint', async function() {
			const { user1 } = await seedTestData();

			// Fetch the user's profile via the related resource endpoint
			const response = await request(app)
				.get(`/api/users/${user1.id}/profileId`)
				.expect(200);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.be.an('object');
			expect(response.body.data).to.have.property('type', 'Profile');
			expect(response.body.data).to.have.property('id');
			expect(response.body.data).to.have.property('attributes');

			// Verify self link
			expect(response.body).to.have.property('links');
			expect(response.body.links.self).to.include(`/api/users/${user1.id}/profileId`);
		});

		it('should return 404 for non-existent parent resource', async function() {
			await request(app)
				.get('/api/users/9999/posts')
				.expect(404);
		});

		it('should return 404 for invalid relationship name', async function() {
			const { user1 } = await seedTestData();

			await request(app)
				.get(`/api/users/${user1.id}/invalidRelationship`)
				.expect(404);
		});

		it('should return null data for belongsTo with no related resource', async function() {
			// Create a post without a user
			const post = await Post.create({
				title: 'Orphan Post',
				content: 'No user'
			});

			const response = await request(app)
				.get(`/api/posts/${post.id}/userId`)
				.expect(200);

			expect(response.body.data).to.be.null;
		});

		it('should return empty array for hasMany with no related resources', async function() {
			// Create a user with no posts
			const user = await User.create({
				name: 'Lonely User',
				email: 'lonely@example.com',
				age: 25
			});

			const response = await request(app)
				.get(`/api/users/${user.id}/posts`)
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(0);
		});

		it('should match related link URL format', async function() {
			const { user1 } = await seedTestData();

			// First get the user to obtain the related link
			const userResponse = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			const relatedLink = userResponse.body.data.relationships.posts.links.related;
			const url = new URL(relatedLink);
			const path = url.pathname;

			// Now fetch using that path
			const relatedResponse = await request(app)
				.get(path)
				.expect(200);

			expect(relatedResponse.body.data).to.be.an('array');
			expect(relatedResponse.body.data).to.have.lengthOf(2);
		});
	});
});
