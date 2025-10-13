'use strict';

const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const jsonapi = require('../index');
const {
	User,
	Post,
	Comment,
	Profile,
	initDatabase,
	resetDatabase,
	closeDatabase,
	seedTestData
} = require('./helpers/setup');

describe('Sequelize-JSONAPI', function() {
	let app;
	let server;

	before(async function() {
		await initDatabase();
	});

	beforeEach(async function() {
		await resetDatabase();

		// Create Express app with routes
		app = express();
		app.use(express.json());

		const router = express.Router();
		jsonapi.createRoutesForModel(router, User);
		jsonapi.createRoutesForModel(router, Post);
		jsonapi.createRoutesForModel(router, Comment);
		jsonapi.createRoutesForModel(router, Profile);

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

	describe('Create Operation', function() {
		it('should create a new user resource', async function() {
			const response = await request(app)
				.post('/api/users')
				.send({
					data: {
						attributes: {
							name: 'Test User',
							email: 'test@example.com',
							age: 28
						}
					}
				})
				.expect(201)
				.expect('Content-Type', /json/);

			expect(response.body).to.have.property('data');
			expect(response.body.data).to.have.property('id');
			expect(response.body.data).to.have.property('type', 'User');
			expect(response.body.data.id).to.be.a('number');
		});

		it('should create a post with belongsTo relationship', async function() {
			const user = await User.create({
				name: 'John Doe',
				email: 'john@example.com',
				age: 30
			});

			const response = await request(app)
				.post('/api/posts')
				.send({
					data: {
						attributes: {
							title: 'New Post',
							content: 'Post content'
						},
						relationships: {
							userId: {
								data: {
									id: user.id,
									type: 'User'
								}
							}
						}
					}
				})
				.expect(201);

			expect(response.body.data.id).to.be.a('number');

			// Verify the relationship was set
			const post = await Post.findByPk(response.body.data.id);
			expect(post.userId).to.equal(user.id);
		});

		it('should create a resource with null belongsTo relationship', async function() {
			const response = await request(app)
				.post('/api/posts')
				.send({
					data: {
						attributes: {
							title: 'Orphan Post',
							content: 'No user'
						},
						relationships: {
							userId: {
								data: null
							}
						}
					}
				})
				.expect(201);

			const post = await Post.findByPk(response.body.data.id);
			expect(post.userId).to.be.null;
		});

		it('should handle missing relationships object', async function() {
			const response = await request(app)
				.post('/api/users')
				.send({
					data: {
						attributes: {
							name: 'Test User',
							email: 'test@example.com'
						}
					}
				})
				.expect(201);

			expect(response.body.data).to.have.property('id');
		});
	});

	describe('GetSingle Operation', function() {
		it('should get a single user without relationships', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.query({ simple: true })
				.expect(200)
				.expect('Content-Type', /json/);

			expect(response.body.data).to.deep.include({
				id: user1.id,
				type: 'User'
			});
			expect(response.body.data.attributes).to.deep.equal({
				name: 'John Doe',
				email: 'john@example.com',
				age: 30
			});
			expect(response.body.data).to.not.have.property('relationships');
		});

		it('should get a single user with relationships', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			expect(response.body.data).to.have.property('id', user1.id);
			expect(response.body.data).to.have.property('type', 'User');
			expect(response.body.data).to.have.property('relationships');
			expect(response.body.data.relationships).to.have.property('posts');
			expect(response.body.data.relationships.posts.data).to.be.an('array');
			expect(response.body.data.relationships.posts.data).to.have.lengthOf(2);
		});

		it('should return 404 for non-existent resource', async function() {
			await request(app)
				.get('/api/users/9999')
				.expect(404);
		});

		it('should include hasMany relationships', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/posts/${post1.id}`)
				.expect(200);

			expect(response.body.data.relationships).to.have.property('comments');
			expect(response.body.data.relationships.comments.data).to.be.an('array');
			expect(response.body.data.relationships.comments.data).to.have.lengthOf(2);
		});

		it('should include hasOne relationships', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.expect(200);

			expect(response.body.data.relationships).to.have.property('profileId');
			expect(response.body.data.relationships.profileId.data).to.have.property('type', 'Profile');
		});

		it('should include belongsTo relationships', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/posts/${post1.id}`)
				.expect(200);

			expect(response.body.data.relationships).to.have.property('userId');
			expect(response.body.data.relationships.userId.data).to.have.property('type', 'User');
		});
	});

	describe('GetList Operation', function() {
		it('should get all users', async function() {
			await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(2);
			expect(response.body.data[0]).to.have.property('type', 'User');
			expect(response.body.data[0]).to.have.property('attributes');
			expect(response.body.data[0].attributes).to.have.property('name');
		});

		it('should get empty array when no resources exist', async function() {
			const response = await request(app)
				.get('/api/users')
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(0);
		});

		it('should filter by id list', async function() {
			const { user1, user2 } = await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: { id: `${user1.id},${user2.id}` } })
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(2);
			expect(response.body.data[0].relationships).to.exist;
		});

		it('should filter by single id', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: { id: user1.id.toString() } })
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(1);
			expect(response.body.data[0].id).to.equal(user1.id);
		});

		it('should filter by custom filter parameters', async function() {
			await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: { name: 'John Doe' } })
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data).to.have.lengthOf(1);
			expect(response.body.data[0].attributes.name).to.equal('John Doe');
		});
	});

	describe('Update Operation', function() {
		it('should update user attributes', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/users/${user1.id}`)
				.send({
					data: {
						attributes: {
							name: 'Updated Name',
							age: 35
						}
					}
				})
				.expect(200);

			expect(response.body.data.attributes.name).to.equal('Updated Name');
			expect(response.body.data.attributes.age).to.equal(35);

			const updatedUser = await User.findByPk(user1.id);
			expect(updatedUser.name).to.equal('Updated Name');
			expect(updatedUser.age).to.equal(35);
		});

		it('should return 404 for non-existent resource', async function() {
			await request(app)
				.patch('/api/users/9999')
				.send({
					data: {
						attributes: {
							name: 'Test'
						}
					}
				})
				.expect(404);
		});

		it('should convert empty strings to null for integer columns', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/users/${user1.id}`)
				.send({
					data: {
						attributes: {
							name: 'John Doe',
							age: ''
						}
					}
				})
				.expect(200);

			const updatedUser = await User.findByPk(user1.id);
			expect(updatedUser.age).to.be.null;
		});

		it('should update belongsTo relationships', async function() {
			const { post1, user2 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/posts/${post1.id}`)
				.send({
					data: {
						attributes: {
							title: 'Updated Post'
						},
						relationships: {
							userId: {
								data: {
									id: user2.id,
									type: 'User'
								}
							}
						}
					}
				})
				.expect(200);

			const updatedPost = await Post.findByPk(post1.id);
			expect(updatedPost.userId).to.equal(user2.id);
		});

		it('should set belongsTo relationship to null', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/posts/${post1.id}`)
				.send({
					data: {
						attributes: {
							title: 'Orphan Post'
						},
						relationships: {
							userId: {
								data: null
							}
						}
					}
				})
				.expect(200);

			const updatedPost = await Post.findByPk(post1.id);
			expect(updatedPost.userId).to.be.null;
		});

		it('should return updated resource with relationships', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.patch(`/api/posts/${post1.id}`)
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
			expect(response.body.data.relationships).to.have.property('userId');
		});
	});

	describe('Delete Operation', function() {
		it('should delete a user resource', async function() {
			const { user1 } = await seedTestData();

			await request(app)
				.delete(`/api/users/${user1.id}`)
				.expect(204);

			const deletedUser = await User.findByPk(user1.id);
			expect(deletedUser).to.be.null;
		});

		it('should return 404 for non-existent resource', async function() {
			await request(app)
				.delete('/api/users/9999')
				.expect(404);
		});

		it('should not return any content on successful delete', async function() {
			const { user2 } = await seedTestData();

			const response = await request(app)
				.delete(`/api/users/${user2.id}`)
				.expect(204);

			expect(response.body).to.be.empty;
		});
	});

	describe('Route Generation', function() {
		it('should create routes with dasherized plural model names', async function() {
			const UserProfile = require('./helpers/setup').sequelize.define('UserProfile', {
				id: {
					type: require('sequelize').DataTypes.INTEGER,
					primaryKey: true,
					autoIncrement: true
				},
				name: { type: require('sequelize').DataTypes.STRING }
			}, { timestamps: false });

			await UserProfile.sync({ force: true });

			const testApp = express();
			testApp.use(express.json());
			const testRouter = express.Router();
			jsonapi.createRoutesForModel(testRouter, UserProfile);
			testApp.use('/api', testRouter);

			// Should create route at /user-profiles (dasherized and pluralized)
			await request(testApp)
				.get('/api/user-profiles')
				.expect(200);
		});
	});

	describe('Edge Cases', function() {
		it('should handle resources with no associations', async function() {
			const SimpleModel = require('./helpers/setup').sequelize.define('SimpleModel', {
				id: {
					type: require('sequelize').DataTypes.INTEGER,
					primaryKey: true,
					autoIncrement: true
				},
				value: { type: require('sequelize').DataTypes.STRING }
			}, { timestamps: false });

			await SimpleModel.sync({ force: true });
			const instance = await SimpleModel.create({ value: 'test' });

			const testApp = express();
			testApp.use(express.json());
			const testRouter = express.Router();
			jsonapi.createRoutesForModel(testRouter, SimpleModel);
			testApp.use('/api', testRouter);

			const response = await request(testApp)
				.get(`/api/simple-models/${instance.id}`)
				.expect(200);

			expect(response.body.data.relationships).to.exist;
			expect(Object.keys(response.body.data.relationships)).to.have.lengthOf(0);
		});

		it('should handle empty filter object', async function() {
			await seedTestData();

			const response = await request(app)
				.get('/api/users')
				.query({ filter: {} })
				.expect(200);

			expect(response.body.data).to.be.an('array');
			expect(response.body.data.length).to.be.greaterThan(0);
		});

		it('should exclude id from attributes', async function() {
			const { user1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/users/${user1.id}`)
				.query({ simple: true })
				.expect(200);

			expect(response.body.data.attributes).to.not.have.property('id');
			expect(response.body.data).to.have.property('id', user1.id);
		});

		it('should exclude association keys from attributes', async function() {
			const { post1 } = await seedTestData();

			const response = await request(app)
				.get(`/api/posts/${post1.id}`)
				.expect(200);

			expect(response.body.data.attributes).to.not.have.property('userId');
			expect(response.body.data.relationships).to.have.property('userId');
		});
	});
});
