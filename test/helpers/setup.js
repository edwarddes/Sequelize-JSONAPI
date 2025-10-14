'use strict';

const { Sequelize, DataTypes } = require('sequelize');

// Create in-memory SQLite database for testing
const sequelize = new Sequelize('sqlite::memory:', {
	logging: false
});

// Define test models
const User = sequelize.define('User', {
	id: {
		type: DataTypes.INTEGER,
		primaryKey: true,
		autoIncrement: true
	},
	name: {
		type: DataTypes.STRING,
		allowNull: false
	},
	email: {
		type: DataTypes.STRING,
		allowNull: false
	},
	age: {
		type: DataTypes.INTEGER,
		allowNull: true
	}
}, {
	timestamps: false
});

const Post = sequelize.define('Post', {
	id: {
		type: DataTypes.INTEGER,
		primaryKey: true,
		autoIncrement: true
	},
	title: {
		type: DataTypes.STRING,
		allowNull: false
	},
	content: {
		type: DataTypes.TEXT,
		allowNull: true
	},
	userId: {
		type: DataTypes.INTEGER,
		allowNull: true
	}
}, {
	timestamps: false
});

const Comment = sequelize.define('Comment', {
	id: {
		type: DataTypes.INTEGER,
		primaryKey: true,
		autoIncrement: true
	},
	text: {
		type: DataTypes.TEXT,
		allowNull: false
	},
	postId: {
		type: DataTypes.INTEGER,
		allowNull: true
	}
}, {
	timestamps: false
});

const Profile = sequelize.define('Profile', {
	id: {
		type: DataTypes.INTEGER,
		primaryKey: true,
		autoIncrement: true
	},
	bio: {
		type: DataTypes.TEXT,
		allowNull: true
	},
	website: {
		type: DataTypes.STRING,
		allowNull: true
	},
	userId: {
		type: DataTypes.INTEGER,
		allowNull: true
	}
}, {
	timestamps: false
});

// Define relationships
User.hasMany(Post, { foreignKey: 'userId', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Post.hasMany(Comment, { foreignKey: 'postId', as: 'comments' });
Comment.belongsTo(Post, { foreignKey: 'postId', as: 'post' });

User.hasOne(Profile, { foreignKey: 'userId', as: 'profile' });
Profile.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Initialize database
async function initDatabase() {
	await sequelize.sync({ force: true });
}

// Reset database between tests
async function resetDatabase() {
	await sequelize.sync({ force: true });
}

// Close database connection
// Note: For in-memory SQLite, we don't actually close the connection
// to allow multiple test suites to run. The connection is cleaned up
// when the Node.js process exits.
async function closeDatabase() {
	// No-op - don't close the shared connection
	// This allows multiple test suites to reuse the same database
}

// Seed test data
async function seedTestData() {
	const user1 = await User.create({
		name: 'John Doe',
		email: 'john@example.com',
		age: 30
	});

	const user2 = await User.create({
		name: 'Jane Smith',
		email: 'jane@example.com',
		age: 25
	});

	const post1 = await Post.create({
		title: 'First Post',
		content: 'This is the first post',
		userId: user1.id
	});

	const post2 = await Post.create({
		title: 'Second Post',
		content: 'This is the second post',
		userId: user1.id
	});

	const post3 = await Post.create({
		title: 'Third Post',
		content: 'This is the third post',
		userId: user2.id
	});

	await Comment.create({
		text: 'Great post!',
		postId: post1.id
	});

	await Comment.create({
		text: 'Thanks for sharing',
		postId: post1.id
	});

	await Profile.create({
		bio: 'Software developer',
		website: 'https://johndoe.com',
		userId: user1.id
	});

	return { user1, user2, post1, post2, post3 };
}

module.exports = {
	sequelize,
	User,
	Post,
	Comment,
	Profile,
	initDatabase,
	resetDatabase,
	closeDatabase,
	seedTestData
};
