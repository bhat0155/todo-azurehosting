pipeline {
    agent any

    environment {
        DOCKERHUB_USER = 'ekamsinghbhatia'
        IMAGE_BACKEND  = "${DOCKERHUB_USER}/todo-backend"
        IMAGE_FRONTEND = "${DOCKERHUB_USER}/todo-frontend"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build') {
            steps {
                sh 'docker-compose build'
            }
        }

        stage('Test') {
            steps {
                sh 'docker-compose run --rm backend sh -c "npm test --if-present"'
            }
        }

        stage('Push to DockerHub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh '''
                        echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                        docker tag todo-azure-backend $IMAGE_BACKEND:$BUILD_NUMBER
                        docker tag todo-azure-frontend $IMAGE_FRONTEND:$BUILD_NUMBER
                        docker push $IMAGE_BACKEND:$BUILD_NUMBER
                        docker push $IMAGE_FRONTEND:$BUILD_NUMBER
                        docker tag todo-azure-backend $IMAGE_BACKEND:latest
                        docker tag todo-azure-frontend $IMAGE_FRONTEND:latest
                        docker push $IMAGE_BACKEND:latest
                        docker push $IMAGE_FRONTEND:latest
                    '''
                }
            }
        }

        stage('Run') {
            steps {
                sh 'docker-compose up -d'
            }
        }
    }

    post {
        success {
            echo 'App is up and running on this machine.'
        }
        failure {
            sh 'docker-compose down'
            echo 'Pipeline failed. Containers stopped.'
        }
    }
}
