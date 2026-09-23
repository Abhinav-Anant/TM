import axios from "axios";
import { BASE_URL, API_PATHS } from "./apiPaths";

// Create axios instance
const axiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
     Accept: "application/json",
  },
});

// Request Interceptor
axiosInstance.interceptors.request.use(
  (config) => {
    const accessToken = localStorage.getItem("token");
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor
axiosInstance.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle errors globally (optional)
    if(error.response){
        // A 401 from the login call itself is a wrong password, not an expired
        // session: redirecting would reload the page and wipe the error message.
        if (error.response.status === 401 && error.config?.url !== API_PATHS.AUTH.LOGIN) {
            window.location.href = "/login";
          }else if(error.response.status===500){
            console.error("Server error, Please try again")
          }
    }else if(error.code==="ECONNABORTED"){
        console.error("Request Timeout,Please try again.")
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
