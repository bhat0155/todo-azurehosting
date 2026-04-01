const BASE_URL = import.meta.env.VITE_API_URL ||'http://localhost:3001';

export const getTodos = async ()=>{
    try{
        const response = await fetch(`${BASE_URL}/todos`);
        const data = await response.json();
        return data
    }catch(err){
        console.log(err)
    }
}

export const createTodo = async (title)=>{
    try{
        let response = await fetch(`${BASE_URL}/todos`,{
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
         body: JSON.stringify({title}),
    })
        const data = await response.json();
        return data
           

    }catch(err){
        console.log(err)
    }
}

export const toggleTodo = async (id,completed)=>{

    try{
        //send patch request to update the completed status of the todo item with the given id
        let response = await fetch(`${BASE_URL}/todos/${id}`, {
            method: "PATCH",
            headers : {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify( {completed} )
        })
        const data = await response.json();
        return data
    }catch(err){
        console.log(err)
    }

    
}

export const deleteTodo = async (id)=>{
    try{
        let res = await fetch(`${BASE_URL}/todos/${id}`,{
            method: 'DELETE'
        })
        return res.status === 200;
    }catch(err){
        console.log(err)
    }
}